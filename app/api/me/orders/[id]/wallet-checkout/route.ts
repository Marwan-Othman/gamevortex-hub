import { NextRequest, NextResponse } from "next/server";
import { findOwnerAccount } from "@/lib/owner-account";
import { DeliveryType, DigitalKeyStatus, LedgerType, Prisma, ProductKind } from "@prisma/client";
import { db } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { guardMutation, internalError, isDatabaseUnavailable, publicErrorCode } from "@/lib/api";
import { logSystemError } from "@/lib/observability";
import { qualifyReferralOnFirstOrder } from "@/lib/referrals";
import { calculateProductRewardPoints, creditPointsInTransaction } from "@/lib/points";
import { applyVipPointsMultiplier, getVipPointsMultiplierInTransaction } from "@/lib/vip";
import { STORE_CONFLICT_ERRORS, orderSaleProblem, ownedGameIds } from "@/lib/store-guards";

export const runtime = "nodejs";

type OrderWithItems = Prisma.OrderGetPayload<{
  include: { items: { include: { product: { include: { game: true } } } } };
}>;

async function deliverGameKeys(tx: Prisma.TransactionClient, order: OrderWithItems) {
  for (const item of order.items) {
    if (item.product.kind !== ProductKind.GAME_KEY || item.product.deliveryType !== DeliveryType.CODE) {
      throw new Error("UNSUPPORTED_DELIVERY_TYPE");
    }
    // Lock the keys we intend to claim. SKIP LOCKED makes concurrent checkouts
    // for the same product pick disjoint keys instead of colliding and failing.
    const keys = await tx.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT "id" FROM "DigitalKey"
        WHERE "productId" = ${item.productId} AND "status" = 'AVAILABLE'
        ORDER BY "createdAt" ASC
        LIMIT ${item.quantity}
        FOR UPDATE SKIP LOCKED`,
    );
    if (keys.length !== item.quantity) throw new Error("OUT_OF_STOCK");
    const claimed = await tx.digitalKey.updateMany({
      where: { id: { in: keys.map((key) => key.id) }, status: DigitalKeyStatus.AVAILABLE },
      data: { status: DigitalKeyStatus.DELIVERED, orderItemId: item.id, deliveredAt: new Date() },
    });
    if (claimed.count !== item.quantity) throw new Error("DIGITAL_KEY_ALREADY_CLAIMED");
    const remaining = await tx.digitalKey.count({
      where: { productId: item.productId, status: DigitalKeyStatus.AVAILABLE },
    });
    await tx.gameProduct.update({
      where: { id: item.productId },
      data: { inventory: remaining },
    });
    await tx.entitlement.upsert({
      where: { userId_gameId: { userId: order.userId, gameId: item.product.gameId } },
      create: { userId: order.userId, gameId: item.product.gameId, orderItemId: item.id },
      update: { revokedAt: null },
    });
  }
}

async function recordOwnerRevenue(tx: Prisma.TransactionClient, order: OrderWithItems, walletTransactionId: string) {
  const owner = await findOwnerAccount(tx);
  if (!owner) throw new Error("OWNER_ACCOUNT_NOT_FOUND");
  const idempotencyKey = `sale-revenue:${order.id}:wallet:${walletTransactionId}`;
  const existing = await tx.ownerLedger.findUnique({ where: { idempotencyKey }, select: { id: true } });
  if (existing) return;
  const wallet = await tx.ownerWallet.upsert({
    where: { ownerId: owner.id },
    create: { ownerId: owner.id, availablePoints: 0, pendingPoints: 0 },
    update: {},
  });
  const usdAmount = new Prisma.Decimal(order.totalCents).div(100);
  await tx.ownerWallet.update({
    where: { id: wallet.id },
    data: { availableUsd: { increment: usdAmount } },
  });
  await tx.ownerLedger.create({
    data: {
      walletId: wallet.id,
      type: LedgerType.CREDIT_REVENUE,
      points: 0,
      usdAmount,
      currency: order.currency,
      provider: "wallet",
      providerTransactionId: walletTransactionId,
      idempotencyKey,
      metadata: { orderId: order.id, source: "GAMEVORTEX_STORE_WALLET_PURCHASE", totalCents: order.totalCents },
    },
  });
}

async function rewardOwnerPoints(tx: Prisma.TransactionClient, order: OrderWithItems, walletTransactionId: string) {
  const points = Number(process.env.OWNER_PURCHASE_POINTS ?? 0);
  if (!Number.isInteger(points) || points <= 0) return;
  const owner = await findOwnerAccount(tx);
  if (!owner) throw new Error("OWNER_ACCOUNT_NOT_FOUND");
  const idempotencyKey = `sale-points:${order.id}:wallet:${walletTransactionId}`;
  const existing = await tx.ownerLedger.findUnique({ where: { idempotencyKey }, select: { id: true } });
  if (existing) return;
  const wallet = await tx.ownerWallet.upsert({
    where: { ownerId: owner.id },
    create: { ownerId: owner.id, availablePoints: points, pendingPoints: 0 },
    update: { availablePoints: { increment: points } },
  });
  await tx.ownerLedger.create({
    data: {
      walletId: wallet.id,
      type: LedgerType.CREDIT_POINTS,
      points,
      usdAmount: null,
      currency: "USD",
      provider: "wallet",
      providerTransactionId: walletTransactionId,
      idempotencyKey,
      metadata: { orderId: order.id, source: "GAMEVORTEX_STORE_WALLET_PURCHASE", rewardPoints: points },
    },
  });
}

async function rewardBuyerPoints(tx: Prisma.TransactionClient, order: OrderWithItems, walletTransactionId: string) {
  const basePoints = calculateProductRewardPoints(order.items.map((item) => ({
    quantity: item.quantity,
    unitPriceCents: item.unitPriceCents,
    currency: order.currency,
    rewardPoints: item.product.rewardPoints,
  })));
  if (basePoints <= 0) return;
  const multiplier = await getVipPointsMultiplierInTransaction(tx, order.userId);
  const points = applyVipPointsMultiplier(basePoints, multiplier);
  await creditPointsInTransaction(tx, {
    userId: order.userId,
    amount: points,
    reason: "STORE_PURCHASE_REWARD",
    sourceId: order.id,
    idempotencyKey: `purchase-points:${order.id}:wallet:${walletTransactionId}`,
    metadata: { orderId: order.id, provider: "wallet", walletTransactionId, currency: order.currency },
  });
}

async function createNotification(tx: Prisma.TransactionClient, order: OrderWithItems, walletTransactionId: string) {
  const idempotencyKey = `notification:store-purchase:${order.id}:wallet:${walletTransactionId}`;
  const existing = await tx.notification.findFirst({
    where: { userId: order.userId, type: "STORE_PURCHASE_COMPLETED", metadata: { path: ["idempotencyKey"], equals: idempotencyKey } },
    select: { id: true },
  });
  if (existing) return;
  await tx.notification.create({
    data: {
      userId: order.userId,
      type: "STORE_PURCHASE_COMPLETED",
      title: "تم إتمام عملية الشراء",
      body: "تم خصم المبلغ من محفظتك وتسليم المنتجات الرقمية المرتبطة بطلبك.",
      metadata: { orderId: order.id, provider: "wallet", walletTransactionId, idempotencyKey },
    },
  });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const blocked = await guardMutation(request, "orders:wallet-checkout", 10);
  if (blocked) return blocked;

  try {
    const user = await requireUser();
    const { id } = await params;

    const result = await db.$transaction(async (tx) => {
      const owned = await tx.order.findFirst({ where: { id, userId: user.id }, select: { id: true } });
      if (!owned) throw new Error("ORDER_NOT_FOUND");

      // Serialize everything that can change this order's payment state (a second
      // click, a card webhook, an admin refund). The status is read again only
      // after the lock is held, so a stale PENDING can never be paid twice.
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Order" WHERE "id" = ${owned.id} FOR UPDATE`);

      const order = await tx.order.findFirst({
        where: { id, userId: user.id },
        include: { items: { include: { product: { include: { game: true } } } } },
      });
      if (!order) throw new Error("ORDER_NOT_FOUND");

      const existingWalletPayment = await tx.payment.findFirst({
        where: { orderId: order.id, provider: "wallet", status: "SUCCEEDED" },
        orderBy: { createdAt: "asc" },
      });
      if (existingWalletPayment && order.status === "COMPLETED" && order.paymentStatus === "SUCCEEDED") {
        return {
          orderId: order.id,
          walletTransactionId: existingWalletPayment.providerPaymentId?.replace("wallet:", "") ?? null,
          balance: null,
          alreadyPaid: true,
        };
      }

      if (order.status !== "PENDING" || order.paymentStatus !== "CREATED") throw new Error("ORDER_NOT_PAYABLE");
      if (!order.items.length || order.totalCents <= 0) throw new Error("ORDER_NOT_PAYABLE");
      if (order.currency.toUpperCase() !== "USD") throw new Error("WALLET_CURRENCY_NOT_SUPPORTED");

      // An order can wait a long time before it is paid: the product must still be on sale at the
      // same price, and the user must not already own the game (no double purchase of the same key).
      const saleProblem = orderSaleProblem(order.items, order.currency);
      if (saleProblem) throw new Error(saleProblem);
      const alreadyOwned = await ownedGameIds(tx, order.userId, order.items.map((item) => item.product.gameId));
      if (alreadyOwned.size > 0) throw new Error("ALREADY_OWNED");

      const wallet = await tx.wallet.findUnique({ where: { userId: user.id } });
      if (!wallet) throw new Error("WALLET_NOT_FOUND");

      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Wallet" WHERE "id" = ${wallet.id} FOR UPDATE`);
      const lockedWallet = await tx.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      const amount = new Prisma.Decimal(order.totalCents).div(100);

      // A replay must be recognised as "already paid" even when the first
      // payment has since emptied the wallet, so this runs before the balance check.
      const idempotencyKey = `wallet-purchase:${order.id}`;
      const existingTransaction = await tx.walletTransaction.findUnique({ where: { idempotencyKey } });
      if (existingTransaction) {
        if (existingTransaction.type === "PURCHASE" && existingTransaction.referenceType === "ORDER" && existingTransaction.referenceId === order.id) {
          return {
            orderId: order.id,
            walletTransactionId: existingTransaction.id,
            balance: existingTransaction.balanceAfter.toString(),
            alreadyPaid: true,
          };
        }
        throw new Error("WALLET_IDEMPOTENCY_CONFLICT");
      }

      if (lockedWallet.balance.lt(amount)) throw new Error("INSUFFICIENT_WALLET_BALANCE");

      const before = lockedWallet.balance;
      const after = before.sub(amount);

      // Conditional debit: the row is only changed while the balance is still
      // what was read under the lock and still covers the price, so the balance
      // can never go below zero even if a code path ever skips the lock.
      const debited = await tx.wallet.updateMany({
        where: { id: wallet.id, balance: { gte: amount } },
        data: { balance: { decrement: amount } },
      });
      if (debited.count !== 1) throw new Error("INSUFFICIENT_WALLET_BALANCE");
      const walletTransaction = await tx.walletTransaction.create({
        data: {
          userId: user.id,
          walletId: wallet.id,
          type: "PURCHASE",
          amount: amount.neg(),
          balanceBefore: before,
          balanceAfter: after,
          currency: order.currency,
          referenceType: "ORDER",
          referenceId: order.id,
          idempotencyKey,
          metadata: { orderId: order.id, source: "GAMEVORTEX_STORE" },
        },
      });

      await deliverGameKeys(tx, order);

      await tx.payment.create({
        data: {
          orderId: order.id,
          provider: "wallet",
          providerPaymentId: `wallet:${walletTransaction.id}`,
          status: "SUCCEEDED",
          amountCents: order.totalCents,
          currency: order.currency,
          rawEvent: { source: "GAMEVORTEX_WALLET", walletTransactionId: walletTransaction.id },
        },
      });

      await tx.order.update({
        where: { id: order.id },
        data: { paymentStatus: "SUCCEEDED", status: "COMPLETED", paymentProvider: "wallet" },
      });

      await recordOwnerRevenue(tx, order, walletTransaction.id);
      await rewardOwnerPoints(tx, order, walletTransaction.id);
      await rewardBuyerPoints(tx, order, walletTransaction.id);
      await createNotification(tx, order, walletTransaction.id);
      await qualifyReferralOnFirstOrder(tx, order.userId);

      return {
        orderId: order.id,
        walletTransactionId: walletTransaction.id,
        balance: after.toString(),
        alreadyPaid: false,
      };
    });

    return NextResponse.json(result, { status: result.alreadyPaid ? 200 : 201 });
  } catch (error) {
    // A database outage is "retry later" (503 + Retry-After), not a bug. The whole payment ran in one
    // transaction, so nothing was charged.
    if (isDatabaseUnavailable(error)) {
      return internalError("orders:wallet-checkout", error, "WALLET_CHECKOUT_FAILED");
    }
    const message = publicErrorCode(error, "WALLET_CHECKOUT_FAILED");
    const known = new Set([
      "ORDER_NOT_FOUND", "INSUFFICIENT_WALLET_BALANCE", "ORDER_NOT_PAYABLE", "WALLET_CURRENCY_NOT_SUPPORTED",
      "WALLET_IDEMPOTENCY_CONFLICT", "OUT_OF_STOCK", "DIGITAL_KEY_ALREADY_CLAIMED", "UNAUTHORIZED",
      "WALLET_NOT_FOUND", "UNSUPPORTED_DELIVERY_TYPE", "OWNER_ACCOUNT_NOT_FOUND",
      ...STORE_CONFLICT_ERRORS,
    ]);
    const status =
      message === "ORDER_NOT_FOUND" ? 404 :
      message === "INSUFFICIENT_WALLET_BALANCE" ? 402 :
      message === "ORDER_NOT_PAYABLE" || message === "WALLET_CURRENCY_NOT_SUPPORTED" || message === "WALLET_IDEMPOTENCY_CONFLICT" ||
      message === "OUT_OF_STOCK" || message === "DIGITAL_KEY_ALREADY_CLAIMED" || STORE_CONFLICT_ERRORS.has(message) ? 409 :
      message === "UNAUTHORIZED" ? 401 :
      known.has(message) ? 400 : 500;
    if (!known.has(message)) {
      // Never hand internal (database) error text to the browser.
      await logSystemError("orders:wallet-checkout", error, { statusCode: 500 });
      return NextResponse.json({ error: "WALLET_CHECKOUT_FAILED" }, { status: 500 });
    }
    return NextResponse.json({ error: message }, { status });
  }
}
