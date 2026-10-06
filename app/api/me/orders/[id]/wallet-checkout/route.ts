import { NextRequest, NextResponse } from "next/server";
import { DeliveryType, DigitalKeyStatus, LedgerType, Prisma, ProductKind } from "@prisma/client";
import { db } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { guardMutation } from "@/lib/api";
import { qualifyReferralOnFirstOrder } from "@/lib/referrals";
import { calculateProductRewardPoints, creditPointsInTransaction } from "@/lib/points";
import { applyVipPointsMultiplier, getVipPointsMultiplierInTransaction } from "@/lib/vip";

export const runtime = "nodejs";

type OrderWithItems = Prisma.OrderGetPayload<{
  include: { items: { include: { product: true } } };
}>;

async function deliverGameKeys(tx: Prisma.TransactionClient, order: OrderWithItems) {
  for (const item of order.items) {
    if (item.product.kind !== ProductKind.GAME_KEY || item.product.deliveryType !== DeliveryType.CODE) {
      throw new Error("UNSUPPORTED_DELIVERY_TYPE");
    }
    const keys = await tx.digitalKey.findMany({
      where: { productId: item.productId, status: DigitalKeyStatus.AVAILABLE },
      orderBy: { createdAt: "asc" },
      take: item.quantity,
      select: { id: true },
    });
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
      update: { revokedAt: null, orderItemId: item.id },
    });
  }
}

async function recordOwnerRevenue(tx: Prisma.TransactionClient, order: OrderWithItems, walletTransactionId: string) {
  const owner = await tx.user.findFirst({ where: { role: "SUPER_ADMIN" }, select: { id: true } });
  if (!owner) throw new Error("OWNER_ACCOUNT_NOT_FOUND");
  const idempotencyKey = `sale-revenue:${order.id}:wallet:${walletTransactionId}`;
  const existing = await tx.ownerLedger.findUnique({ where: { idempotencyKey }, select: { id: true } });
  if (existing) return;
  const wallet = await tx.ownerWallet.upsert({
    where: { ownerId: owner.id },
    create: { ownerId: owner.id, availablePoints: 0, pendingPoints: 0 },
    update: {},
  });
  await tx.ownerLedger.create({
    data: {
      walletId: wallet.id,
      type: LedgerType.CREDIT_REVENUE,
      points: 0,
      usdAmount: new Prisma.Decimal(order.totalCents).div(100),
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
  const owner = await tx.user.findFirst({ where: { role: "SUPER_ADMIN" }, select: { id: true } });
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
      const order = await tx.order.findFirst({
        where: { id, userId: user.id },
        include: { items: { include: { product: true } } },
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

      const wallet = await tx.wallet.findUnique({ where: { userId: user.id } });
      if (!wallet) throw new Error("WALLET_NOT_FOUND");

      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Wallet" WHERE "id" = ${wallet.id} FOR UPDATE`);
      const lockedWallet = await tx.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
      const amount = new Prisma.Decimal(order.totalCents).div(100);

      if (lockedWallet.balance.lt(amount)) throw new Error("INSUFFICIENT_WALLET_BALANCE");

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

      const before = lockedWallet.balance;
      const after = before.sub(amount);

      await tx.wallet.update({ where: { id: wallet.id }, data: { balance: after } });
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
    const message = error instanceof Error ? error.message : "WALLET_CHECKOUT_FAILED";
    const status =
      message === "ORDER_NOT_FOUND" ? 404 :
      message === "INSUFFICIENT_WALLET_BALANCE" ? 402 :
      message === "ORDER_NOT_PAYABLE" || message === "WALLET_CURRENCY_NOT_SUPPORTED" ||
      message === "OUT_OF_STOCK" || message === "DIGITAL_KEY_ALREADY_CLAIMED" ? 409 :
      message === "UNAUTHORIZED" ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
