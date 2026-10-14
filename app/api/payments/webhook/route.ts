import { NextRequest, NextResponse } from "next/server";
import { findOwnerAccount } from "@/lib/owner-account";
import {
  DeliveryType,
  DigitalKeyStatus,
  LedgerType,
  Prisma,
  ProductKind,
} from "@prisma/client";
import { db } from "@/lib/prisma";
import {
  ConfiguredPaymentProvider,
  resolveStripePaymentIntentReference,
} from "@/lib/payments";
import { qualifyReferralOnFirstOrder } from "@/lib/referrals";
import { rateLimitAsync, clientKey } from "@/lib/security";
import { logSystemError } from "@/lib/observability";
import { processVipPaymentWebhook } from "@/lib/vip-payment-webhook";
import { calculateProductRewardPoints, creditPointsInTransaction, reversePointsInTransaction } from "@/lib/points";
import { applyVipPointsMultiplier, getVipPointsMultiplierInTransaction } from "@/lib/vip";
import { revokeEntitlementsForRefund } from "@/lib/store-guards";
import { publicErrorCode } from "@/lib/api";

export const runtime = "nodejs";

type NormalizedEvent = {
  provider: string;
  paymentId: string;
  orderId: string;
  status: "SUCCEEDED" | "FAILED" | "REFUNDED";
  amountCents: number;
  currency?: string;
  providerOrderId?: string;
  raw: unknown;
};

type WebhookOrder = Prisma.OrderGetPayload<{
  include: {
    items: {
      include: {
        product: true;
      };
    };
  };
}>;

function getOwnerPurchasePoints(): number {
  const raw = process.env.OWNER_PURCHASE_POINTS;

  if (!raw) return 0;

  const parsed = Number(raw);

  if (!Number.isInteger(parsed) || parsed < 0) {
    return 0;
  }

  return parsed;
}

function normalizeStripe(raw: any): NormalizedEvent | null {
  const type = String(raw?.type || "");
  const object = raw?.data?.object;

  if (!object) {
    return null;
  }

  const status =
    type === "checkout.session.completed" ||
    type === "checkout.session.async_payment_succeeded"
      ? "SUCCEEDED"
      : type === "checkout.session.async_payment_failed"
        ? "FAILED"
        : type === "charge.refunded"
          ? "REFUNDED"
          : null;

  if (!status) {
    return null;
  }

  const orderId = String(object?.metadata?.orderId || "");

  // Stripe charge.refunded events identify the Charge, while the local
  // payment row normally stores the Checkout Session ID. The order/reference
  // is carried by the PaymentIntent metadata configured at checkout.
  if (!orderId && status !== "REFUNDED") {
    return null;
  }

  // A refund event must carry the amount that was actually refunded. Using the
  // original charge amount would make a partial refund look like a full one
  // and reverse the whole order (keys, owner revenue and points).
  const amountCents = Number(
    status === "REFUNDED"
      ? object?.amount_refunded ?? -1
      : object?.amount_total ?? object?.amount ?? -1,
  );

  return {
    provider: "stripe",
    paymentId: String(object.id),
    orderId,
    status,
    amountCents,
    currency: object.currency
      ? String(object.currency).toUpperCase()
      : undefined,
    providerOrderId:
      typeof object?.payment_intent === "string"
        ? object.payment_intent
        : undefined,
    raw,
  };
}

function normalizePayPal(raw: any): NormalizedEvent | null {
  const type = String(raw?.event_type || "");
  const resource = raw?.resource;

  if (!resource) {
    return null;
  }

  const isSuccess = type === "PAYMENT.CAPTURE.COMPLETED";
  const isRefund = type === "PAYMENT.CAPTURE.REFUNDED";

  if (!isSuccess && !isRefund) {
    return null;
  }

  const orderId = String(
    resource?.custom_id ||
      resource?.supplementary_data?.related_ids?.order_id ||
      resource?.purchase_units?.[0]?.reference_id ||
      "",
  );

  if (!orderId) {
    return null;
  }

  const amount = resource?.amount;
  const amountCents = Math.round(Number(amount?.value || 0) * 100);

  return {
    provider: "paypal",
    paymentId: String(resource?.id || raw?.id),
    orderId,
    status: isSuccess ? "SUCCEEDED" : "REFUNDED",
    amountCents,
    currency: amount?.currency_code
      ? String(amount.currency_code).toUpperCase()
      : undefined,
    providerOrderId: resource?.supplementary_data?.related_ids?.order_id
      ? String(resource.supplementary_data.related_ids.order_id)
      : undefined,
    raw,
  };
}

function normalizeGeneric(raw: any): NormalizedEvent | null {
  if (!raw?.provider || !raw?.paymentId || !raw?.orderId) {
    return null;
  }

  if (
    !["SUCCEEDED", "FAILED", "REFUNDED"].includes(
      String(raw.status),
    )
  ) {
    return null;
  }

  return {
    provider: String(raw.provider),
    paymentId: String(raw.paymentId),
    orderId: String(raw.orderId),
    status: raw.status,
    amountCents: Number(raw.amountCents),
    currency: raw.currency
      ? String(raw.currency).toUpperCase()
      : undefined,
    raw,
  };
}

async function deliverGameKeys(
  transaction: Prisma.TransactionClient,
  order: WebhookOrder,
) {
  for (const item of order.items) {
    if (
      item.product.kind !== ProductKind.GAME_KEY ||
      item.product.deliveryType !== DeliveryType.CODE
    ) {
      throw new Error("UNSUPPORTED_DELIVERY_TYPE");
    }

    // Row-lock the keys to claim (SKIP LOCKED) so concurrent webhook deliveries
    // for the same product never select the same keys.
    const availableKeys = await transaction.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT "id" FROM "DigitalKey"
        WHERE "productId" = ${item.productId} AND "status" = 'AVAILABLE'
        ORDER BY "createdAt" ASC
        LIMIT ${item.quantity}
        FOR UPDATE SKIP LOCKED`,
    );

    if (availableKeys.length !== item.quantity) {
      throw new Error("OUT_OF_STOCK");
    }

    for (const key of availableKeys) {
      const claimed =
        await transaction.digitalKey.updateMany({
          where: {
            id: key.id,
            status: DigitalKeyStatus.AVAILABLE,
          },
          data: {
            status: DigitalKeyStatus.DELIVERED,
            orderItemId: item.id,
            deliveredAt: new Date(),
          },
        });

      if (claimed.count !== 1) {
        throw new Error("DIGITAL_KEY_ALREADY_CLAIMED");
      }
    }

    const remaining =
      await transaction.digitalKey.count({
        where: {
          productId: item.productId,
          status: DigitalKeyStatus.AVAILABLE,
        },
      });

    await transaction.gameProduct.update({
      where: {
        id: item.productId,
      },
      data: {
        inventory: remaining,
      },
    });

    await transaction.entitlement.upsert({
      where: {
        userId_gameId: {
          userId: order.userId,
          gameId: item.product.gameId,
        },
      },
      create: {
        userId: order.userId,
        gameId: item.product.gameId,
        orderItemId: item.id,
      },
      update: {
        revokedAt: null,
      },
    });
  }
}

async function rewardOwnerPoints(
  transaction: Prisma.TransactionClient,
  order: {
    id: string;
  },
  provider: string,
  paymentId: string,
) {
  const rewardPoints = getOwnerPurchasePoints();

  if (rewardPoints <= 0) {
    return;
  }

  const owner = await findOwnerAccount(transaction);

  if (!owner) {
    throw new Error("OWNER_ACCOUNT_NOT_FOUND");
  }

  const idempotencyKey =
    `sale-points:${order.id}:${provider}:${paymentId}`;

  /*
   * IMPORTANT:
   * Check idempotency BEFORE changing OwnerWallet.
   * Otherwise a duplicated webhook could award the owner
   * the same points more than once.
   */
  const existing =
    await transaction.ownerLedger.findUnique({
      where: {
        idempotencyKey,
      },
    });

  if (existing) {
    return;
  }

  const wallet =
    await transaction.ownerWallet.upsert({
      where: {
        ownerId: owner.id,
      },
      create: {
        ownerId: owner.id,
        availablePoints: rewardPoints,
        pendingPoints: 0,
      },
      update: {
        availablePoints: {
          increment: rewardPoints,
        },
      },
    });

  await transaction.ownerLedger.create({
    data: {
      walletId: wallet.id,
      type: LedgerType.CREDIT_POINTS,
      points: rewardPoints,
      usdAmount: null,
      currency: "USD",
      provider,
      providerTransactionId: paymentId,
      idempotencyKey,
      metadata: {
        orderId: order.id,
        rewardPoints,
        source: "GAMEVORTEX_STORE_PURCHASE",
      },
    },
  });
}

async function rewardBuyerPoints(
  transaction: Prisma.TransactionClient,
  order: {
    id: string;
    userId: string;
    currency: string;
    items: Array<{
      productId: string;
      quantity: number;
      unitPriceCents: number;
      product: { rewardPoints: number | null };
    }>;
  },
  provider: string,
  paymentId: string,
) {
  const rewardLines = order.items.map((item) => ({
    productId: item.productId,
    quantity: item.quantity,
    rewardPoints: item.product.rewardPoints,
  }));
  const basePoints = calculateProductRewardPoints(order.items.map((item) => ({
    quantity: item.quantity,
    unitPriceCents: item.unitPriceCents,
    currency: order.currency,
    rewardPoints: item.product.rewardPoints,
  })));
  if (basePoints <= 0) return;
  const vipMultiplier = await getVipPointsMultiplierInTransaction(transaction, order.userId);
  const points = applyVipPointsMultiplier(basePoints, vipMultiplier);
  await creditPointsInTransaction(transaction, {
    userId: order.userId,
    amount: points,
    reason: "STORE_PURCHASE_REWARD",
    sourceId: order.id,
    idempotencyKey: `purchase-points:${order.id}:${provider}:${paymentId}`,
    metadata: { orderId: order.id, provider, paymentId, currency: order.currency, rewardLines },
  });
}

async function refundBuyerPoints(
  transaction: Prisma.TransactionClient,
  order: { id: string; userId: string },
  provider: string,
  paymentId: string,
) {
  const originalPayment = await transaction.payment.findFirst({
    where: {
      orderId: order.id,
      provider,
      status: "SUCCEEDED",
    },
    orderBy: { createdAt: "asc" },
    select: { providerPaymentId: true },
  });

  if (!originalPayment?.providerPaymentId) return;

  const purchaseKey =
    `purchase-points:${order.id}:${provider}:${originalPayment.providerPaymentId}`;
  const reward = await transaction.pointLedger.findUnique({
    where: { idempotencyKey: purchaseKey },
  });

  if (!reward || reward.userId !== order.userId || reward.amount <= 0) return;

  await reversePointsInTransaction(transaction, {
    userId: order.userId,
    amount: reward.amount,
    reason: "STORE_PURCHASE_REFUND",
    sourceId: order.id,
    idempotencyKey: `refund-points:${order.id}:${provider}:${paymentId}`,
  });
}

async function recordOwnerRevenue(
  transaction: Prisma.TransactionClient,
  order: {
    id: string;
    totalCents: number;
    currency: string;
  },
  provider: string,
  paymentId: string,
) {
  const owner = await findOwnerAccount(transaction);

  if (!owner) {
    throw new Error("OWNER_ACCOUNT_NOT_FOUND");
  }

  const idempotencyKey =
    `sale-revenue:${order.id}:${provider}:${paymentId}`;

  const existing =
    await transaction.ownerLedger.findUnique({
      where: {
        idempotencyKey,
      },
    });

  if (existing) {
    return;
  }

  const wallet =
    await transaction.ownerWallet.upsert({
      where: {
        ownerId: owner.id,
      },
      create: {
        ownerId: owner.id,
        availablePoints: 0,
        pendingPoints: 0,
      },
      update: {},
    });

  // OwnerWallet.availableUsd is a USD balance. An order in another currency
  // must not be added to it as if it were dollars; it is still written to the
  // ledger (with usdAmount = null) so the sale stays traceable.
  const isUsd = (order.currency || "USD").toUpperCase() === "USD";
  const usdAmount = isUsd
    ? new Prisma.Decimal(order.totalCents).div(100)
    : null;

  if (usdAmount) {
    await transaction.ownerWallet.update({
      where: { id: wallet.id },
      data: { availableUsd: { increment: usdAmount } },
    });
  }

  await transaction.ownerLedger.create({
    data: {
      walletId: wallet.id,
      type: LedgerType.CREDIT_REVENUE,
      points: 0,
      usdAmount,
      currency: order.currency || "USD",
      provider,
      providerTransactionId: paymentId,
      idempotencyKey,
      metadata: {
        orderId: order.id,
        source: "GAMEVORTEX_STORE_PURCHASE",
        totalCents: order.totalCents,
        ...(isUsd ? {} : { notCreditedToUsdBalance: true }),
      },
    },
  });
}

async function createPurchaseNotification(
  transaction: Prisma.TransactionClient,
  order: WebhookOrder,
  provider: string,
  paymentId: string,
) {
  const idempotencyKey =
    `notification:store-purchase:${order.id}:${provider}:${paymentId}`;

  const existing =
    await transaction.notification.findFirst({
      where: {
        userId: order.userId,
        type: "STORE_PURCHASE_COMPLETED",
        metadata: {
          path: ["idempotencyKey"],
          equals: idempotencyKey,
        },
      },
      select: {
        id: true,
      },
    });

  if (existing) {
    return;
  }

  await transaction.notification.create({
    data: {
      userId: order.userId,
      type: "STORE_PURCHASE_COMPLETED",
      title: "تم إتمام عملية الشراء",
      body:
        "تم تأكيد الدفع وتسليم المنتجات الرقمية المرتبطة بطلبك.",
      metadata: {
        orderId: order.id,
        provider,
        paymentId,
        idempotencyKey,
      },
    },
  });
}

async function refundOwnerRevenue(
  transaction: Prisma.TransactionClient,
  order: {
    id: string;
    currency: string;
  },
  provider: string,
  paymentId: string,
) {
  const refundIdempotencyKey =
    `refund-revenue:${order.id}:${provider}:${paymentId}`;

  const existingRefund =
    await transaction.ownerLedger.findUnique({
      where: { idempotencyKey: refundIdempotencyKey },
    });

  if (existingRefund) return;

  const originalPayment =
    await transaction.payment.findFirst({
      where: {
        orderId: order.id,
        provider,
        status: { in: ["SUCCEEDED", "REFUNDED"] },
      },
      orderBy: { createdAt: "asc" },
      select: { providerPaymentId: true },
    });

  if (!originalPayment?.providerPaymentId) return;

  const saleLedger =
    await transaction.ownerLedger.findUnique({
      where: {
        idempotencyKey:
          `sale-revenue:${order.id}:${provider}:${originalPayment.providerPaymentId}`,
      },
    });

  if (!saleLedger) return;

  const wallet =
    await transaction.ownerWallet.findUnique({
      where: { id: saleLedger.walletId },
    });

  if (!wallet) {
    throw new Error("OWNER_WALLET_NOT_FOUND");
  }

  const refundUsd =
    saleLedger.usdAmount ?? new Prisma.Decimal(0);

  const debited =
    await transaction.ownerWallet.updateMany({
      where: {
        id: wallet.id,
        availableUsd: { gte: refundUsd },
      },
      data: {
        availableUsd: { decrement: refundUsd },
      },
    });

  if (debited.count !== 1) {
    throw new Error("OWNER_USD_BALANCE_INSUFFICIENT_FOR_REFUND");
  }

  await transaction.ownerLedger.create({
    data: {
      walletId: wallet.id,
      type: LedgerType.REFUND,
      points: 0,
      usdAmount: refundUsd.neg(),
      currency: order.currency || "USD",
      provider,
      providerTransactionId: paymentId,
      idempotencyKey: refundIdempotencyKey,
      metadata: {
        orderId: order.id,
        source: "GAMEVORTEX_STORE_REFUND",
        originalLedgerId: saleLedger.id,
      },
    },
  });
}

async function refundOwnerPoints(
  transaction: Prisma.TransactionClient,
  order: {
    id: string;
  },
  provider: string,
  paymentId: string,
) {
  const refundIdempotencyKey =
    `refund-points:${order.id}:${provider}:${paymentId}`;

  const existingRefund =
    await transaction.ownerLedger.findUnique({
      where: {
        idempotencyKey: refundIdempotencyKey,
      },
    });

  if (existingRefund) {
    return;
  }

  const originalPayment =
    await transaction.payment.findFirst({
      where: {
        orderId: order.id,
        provider,
        status: "SUCCEEDED",
      },
      orderBy: { createdAt: "asc" },
      select: { providerPaymentId: true },
    });

  if (!originalPayment) return;

  const saleLedger =
    await transaction.ownerLedger.findUnique({
      where: {
        idempotencyKey:
          `sale-points:${order.id}:${provider}:${originalPayment.providerPaymentId}`,
      },
    });

  if (!saleLedger || saleLedger.points <= 0) {
    return;
  }

  const wallet =
    await transaction.ownerWallet.findUnique({
      where: {
        id: saleLedger.walletId,
      },
    });

  if (!wallet) {
    throw new Error("OWNER_WALLET_NOT_FOUND");
  }

  const pointsToReturn = Math.min(
    saleLedger.points,
    Math.max(wallet.availablePoints, 0),
  );

  if (pointsToReturn > 0) {
    await transaction.ownerWallet.update({
      where: {
        id: wallet.id,
      },
      data: {
        availablePoints: {
          decrement: pointsToReturn,
        },
      },
    });
  }

  await transaction.ownerLedger.create({
    data: {
      walletId: wallet.id,
      type: LedgerType.REFUND,
      points: -pointsToReturn,
      usdAmount: null,
      currency: "USD",
      provider,
      providerTransactionId: paymentId,
      idempotencyKey: refundIdempotencyKey,
      metadata: {
        orderId: order.id,
        source: "GAMEVORTEX_STORE_REFUND",
        originalLedgerId: saleLedger.id,
        originalPoints: saleLedger.points,
        refundedPoints: pointsToReturn,
      },
    },
  });
}

/**
 * Releases the "pending" part of a wallet deposit that will never complete
 * (failed, cancelled or refunded before it was credited). The release is
 * clamped to what the wallet really holds as pending so a drifted counter can
 * never be pushed below zero.
 */
async function releasePendingDeposit(
  transaction: Prisma.TransactionClient,
  userId: string,
  amount: Prisma.Decimal,
) {
  const wallet = await transaction.wallet.findUnique({ where: { userId } });
  if (!wallet) return new Prisma.Decimal(0);

  await transaction.$queryRaw(
    Prisma.sql`SELECT "id" FROM "Wallet" WHERE "id" = ${wallet.id} FOR UPDATE`,
  );
  const locked = await transaction.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
  const release = locked.pendingBalance.lt(amount) ? locked.pendingBalance : amount;
  if (release.gt(0)) {
    await transaction.wallet.update({
      where: { id: wallet.id },
      data: { pendingBalance: { decrement: release } },
    });
  }
  return release;
}

async function processWalletDepositWebhook(event: NormalizedEvent) {
  return db.$transaction(async (transaction) => {
    const depositExists = await transaction.walletDeposit.findUnique({
      where: { id: event.orderId },
      select: { id: true },
    });

    if (!depositExists) return false;

    // Serialize all provider events for this deposit before reading its status.
    // This prevents concurrent duplicate webhooks from both observing PENDING
    // and creating duplicate balance changes or notifications.
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "WalletDeposit" WHERE "id" = ${event.orderId} FOR UPDATE`,
    );

    const deposit = await transaction.walletDeposit.findUnique({
      where: { id: event.orderId },
    });

    if (!deposit) return false;

    if (event.amountCents !== deposit.amountCents) {
      throw new Error("PAYMENT_AMOUNT_MISMATCH");
    }

    // Wallet.balance is a single USD-denominated balance. A webhook with a
    // different currency must never be allowed to credit or debit it.
    const eventCurrency = event.currency?.toUpperCase();
    const depositCurrency = deposit.currency.toUpperCase();
    if (depositCurrency !== "USD" || eventCurrency !== depositCurrency) {
      throw new Error("PAYMENT_CURRENCY_MISMATCH");
    }

    // Success events use the payment/order identifier created at checkout.
    // Refund events may legitimately carry a different provider transaction
    // identifier (for example a Stripe charge/refund identifier).
    const expectedProviderPaymentId =
      event.provider === "paypal" && event.providerOrderId
        ? event.providerOrderId
        : event.paymentId;

    if (
      event.status === "SUCCEEDED" &&
      deposit.providerPaymentId &&
      deposit.providerPaymentId !== expectedProviderPaymentId
    ) {
      throw new Error("PAYMENT_ID_MISMATCH");
    }

    const amount = new Prisma.Decimal(deposit.amountCents).div(100);

    if (event.status === "SUCCEEDED") {
      if (deposit.status === "COMPLETED") return true;
      if (deposit.status === "REFUNDED") return true;

      const wallet = await transaction.wallet.upsert({
        where: { userId: deposit.userId },
        create: { userId: deposit.userId, balance: new Prisma.Decimal(0), pendingBalance: new Prisma.Decimal(0) },
        update: {},
      });

      // Serialize concurrent balance changes for this wallet. Without a row lock,
      // two signed webhooks can both read the same balance and lose one update.
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "Wallet" WHERE "id" = ${wallet.id} FOR UPDATE`,
      );

      const lockedWallet = await transaction.wallet.findUniqueOrThrow({
        where: { id: wallet.id },
      });

      const idempotencyKey = `wallet-deposit:${deposit.id}:${event.provider}:${event.paymentId}`;
      const existing = await transaction.walletTransaction.findUnique({ where: { idempotencyKey } });
      if (!existing) {
        const before = lockedWallet.balance;
        const after = before.add(amount);

        // The provider confirmed that the money arrived, so the balance is
        // always credited. Only a deposit that is still PENDING has an amount
        // sitting in pendingBalance; a deposit already marked FAILED/CANCELLED
        // (for example after a timeout on our side) had it released already.
        // Throwing here would leave real money received but never credited and
        // make the provider retry the webhook forever.
        const pendingToRelease =
          deposit.status === "PENDING"
            ? (lockedWallet.pendingBalance.lt(amount) ? lockedWallet.pendingBalance : amount)
            : new Prisma.Decimal(0);
        const pendingShortfall = deposit.status === "PENDING" ? amount.sub(pendingToRelease) : new Prisma.Decimal(0);

        const settled = await transaction.wallet.updateMany({
          where: {
            id: wallet.id,
            balance: before,
            pendingBalance: { gte: pendingToRelease },
          },
          data: {
            balance: after,
            pendingBalance: { decrement: pendingToRelease },
          },
        });

        if (settled.count !== 1) {
          throw new Error("WALLET_BALANCE_CHANGED");
        }
        await transaction.walletTransaction.create({
          data: {
            userId: deposit.userId,
            walletId: wallet.id,
            type: "DEPOSIT",
            amount,
            balanceBefore: before,
            balanceAfter: after,
            currency: deposit.currency,
            referenceType: "WALLET_DEPOSIT",
            referenceId: deposit.id,
            idempotencyKey,
            metadata: {
              provider: event.provider,
              paymentId: event.paymentId,
              depositStatusBefore: deposit.status,
              ...(pendingShortfall.gt(0) ? { pendingShortfall: pendingShortfall.toString() } : {}),
            },
          },
        });
      }

      await transaction.walletDeposit.update({ where: { id: deposit.id }, data: { status: "COMPLETED", providerPaymentId: event.paymentId } });
      await transaction.notification.create({
        data: {
          userId: deposit.userId,
          type: "WALLET_DEPOSIT_COMPLETED",
          title: "تمت إضافة الأموال إلى محفظتك",
          body: `تمت إضافة ${deposit.amountCents / 100} ${deposit.currency} إلى المحفظة المالية.`,
          metadata: { depositId: deposit.id, provider: event.provider, paymentId: event.paymentId },
        },
      });
      return true;
    }

    if (event.status === "REFUNDED") {
      if (deposit.status === "REFUNDED") return true;
      if (deposit.status !== "COMPLETED") {
        // The deposit was never credited, so there is nothing to take back from
        // the balance; only the pending amount (if any) is released.
        if (deposit.status === "PENDING") {
          await releasePendingDeposit(transaction, deposit.userId, amount);
        }

        await transaction.walletDeposit.update({
          where: { id: deposit.id },
          data: { status: "REFUNDED" },
        });
        return true;
      }

      const wallet = await transaction.wallet.findUnique({ where: { userId: deposit.userId } });
      if (!wallet) throw new Error("WALLET_NOT_FOUND");

      // Serialize the refund against concurrent deposits/purchases/refunds.
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "Wallet" WHERE "id" = ${wallet.id} FOR UPDATE`,
      );

      const lockedWallet = await transaction.wallet.findUniqueOrThrow({
        where: { id: wallet.id },
      });

      // A provider refund is a real liability reversal. The user may already
      // have spent the deposited funds, so the ledger must still record the
      // full debit instead of silently leaving the wallet over-credited.
      // The balance can therefore become negative here (and only here); every
      // spending path checks `balance >= amount`, so a negative wallet cannot
      // spend anything until it is topped up again. The transaction is flagged
      // so it can be found and followed up.
      const idempotencyKey = `wallet-refund:${deposit.id}:${event.provider}:${event.paymentId}`;
      const existing = await transaction.walletTransaction.findUnique({ where: { idempotencyKey } });
      if (!existing) {
        const before = lockedWallet.balance;
        const after = before.sub(amount);
        const debited = await transaction.wallet.updateMany({
          where: { id: wallet.id, balance: before },
          data: { balance: after },
        });
        if (debited.count !== 1) throw new Error("WALLET_BALANCE_CHANGED");
        await transaction.walletTransaction.create({
          data: {
            userId: deposit.userId,
            walletId: wallet.id,
            type: "REFUND",
            amount: amount.neg(),
            balanceBefore: before,
            balanceAfter: after,
            currency: deposit.currency,
            referenceType: "WALLET_DEPOSIT_REFUND",
            referenceId: deposit.id,
            idempotencyKey,
            metadata: {
              provider: event.provider,
              paymentId: event.paymentId,
              ...(after.isNegative() ? { resultedInNegativeBalance: true } : {}),
            },
          },
        });
      }
      await transaction.walletDeposit.update({ where: { id: deposit.id }, data: { status: "REFUNDED" } });
      return true;
    }

    // FAILED: only a deposit that is still PENDING may move to FAILED. A late
    // or out-of-order failure event must never turn a COMPLETED or REFUNDED
    // deposit (whose balance changes are already booked) into FAILED.
    if (deposit.status === "PENDING") {
      await releasePendingDeposit(transaction, deposit.userId, amount);
      await transaction.walletDeposit.update({
        where: { id: deposit.id },
        data: { status: "FAILED" },
      });
    }
    return true;
  });
}

async function refundApiAccessOwnerRevenue(
  transaction: Prisma.TransactionClient,
  purchase: {
    id: string;
    currency: string;
    providerPaymentId: string | null;
  },
  provider: string,
  refundPaymentId: string,
) {
  const refundIdempotencyKey =
    `refund-api-access-revenue:${purchase.id}:${provider}:${refundPaymentId}`;

  const existingRefund =
    await transaction.ownerLedger.findUnique({
      where: { idempotencyKey: refundIdempotencyKey },
      select: { id: true },
    });

  if (existingRefund) return;
  if (!purchase.providerPaymentId) return;

  const saleLedger =
    await transaction.ownerLedger.findUnique({
      where: {
        idempotencyKey:
          `api-access-revenue:${purchase.id}:${provider}:${purchase.providerPaymentId}`,
      },
      select: {
        id: true,
        walletId: true,
        usdAmount: true,
      },
    });

  if (!saleLedger) return;

  const refundUsd =
    saleLedger.usdAmount ?? new Prisma.Decimal(0);

  const debited =
    await transaction.ownerWallet.updateMany({
      where: {
        id: saleLedger.walletId,
        availableUsd: { gte: refundUsd },
      },
      data: {
        availableUsd: { decrement: refundUsd },
      },
    });

  if (debited.count !== 1) {
    throw new Error("OWNER_USD_BALANCE_INSUFFICIENT_FOR_REFUND");
  }

  await transaction.ownerLedger.create({
    data: {
      walletId: saleLedger.walletId,
      type: LedgerType.REFUND,
      points: 0,
      usdAmount: refundUsd.neg(),
      currency: purchase.currency,
      provider,
      providerTransactionId: refundPaymentId,
      idempotencyKey: refundIdempotencyKey,
      metadata: {
        apiAccessPurchaseId: purchase.id,
        source: "API_ACCESS_REFUND",
        originalLedgerId: saleLedger.id,
      },
    },
  });
}

async function processApiAccessPaymentWebhook(event: NormalizedEvent) {
  await db.$transaction(async (transaction) => {
    // Serialize concurrent provider events for the same purchase.
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "ApiAccessPurchase" WHERE "id" = ${event.orderId} FOR UPDATE`,
    );
    const purchase = await transaction.apiAccessPurchase.findUnique({ where: { id: event.orderId } });
    if (!purchase) throw new Error("API_ACCESS_PURCHASE_NOT_FOUND");
    if (event.amountCents !== purchase.amountCents || event.currency?.toUpperCase() !== purchase.currency) {
      throw new Error("PAYMENT_AMOUNT_MISMATCH");
    }
    if (purchase.provider && purchase.provider !== event.provider) throw new Error("PAYMENT_PROVIDER_MISMATCH");
    if (purchase.providerPaymentId && purchase.providerPaymentId !== event.paymentId && purchase.providerPaymentId !== event.providerOrderId) {
      throw new Error("PAYMENT_ID_MISMATCH");
    }

    if (event.status === "SUCCEEDED") {
      if (purchase.status === "REFUNDED") return;
      if (purchase.status === "SUCCEEDED") return;

      await transaction.apiAccessPurchase.update({
        where: { id: purchase.id },
        data: { status: "SUCCEEDED", provider: event.provider, providerPaymentId: event.paymentId, completedAt: new Date() },
      });

      const owner = await findOwnerAccount(transaction);
      if (!owner) throw new Error("OWNER_ACCOUNT_NOT_FOUND");
      const wallet = await transaction.ownerWallet.upsert({
        where: { ownerId: owner.id },
        create: { ownerId: owner.id },
        update: {},
      });
      const idempotencyKey = `api-access-revenue:${purchase.id}:${event.provider}:${event.paymentId}`;
      const existing = await transaction.ownerLedger.findUnique({ where: { idempotencyKey }, select: { id: true } });
      if (!existing) {
        const usdAmount = new Prisma.Decimal(purchase.amountCents).div(100);

        await transaction.ownerWallet.update({
          where: { id: wallet.id },
          data: { availableUsd: { increment: usdAmount } },
        });

        await transaction.ownerLedger.create({
          data: {
            walletId: wallet.id,
            type: LedgerType.CREDIT_REVENUE,
            points: 0,
            usdAmount,
            currency: purchase.currency,
            provider: event.provider,
            providerTransactionId: event.paymentId,
            idempotencyKey,
            metadata: { apiAccessPurchaseId: purchase.id, source: "API_ACCESS_PURCHASE" },
          },
        });
      }
      return;
    }

    if (event.status === "REFUNDED") {
      if (purchase.status === "REFUNDED") return;

      await refundApiAccessOwnerRevenue(
        transaction,
        purchase,
        event.provider,
        event.paymentId,
      );

      await transaction.apiAccessPurchase.update({
        where: { id: purchase.id },
        data: {
          status: "REFUNDED",
          provider: event.provider,
          providerPaymentId: purchase.providerPaymentId || event.paymentId,
        },
      });
      return;
    }

    if (purchase.status !== "SUCCEEDED" && purchase.status !== "REFUNDED") {
      await transaction.apiAccessPurchase.update({ where: { id: purchase.id }, data: { status: "FAILED", provider: event.provider, providerPaymentId: event.paymentId } });
    }
  });
}

const MAX_WEBHOOK_BYTES = 1_000_000;

export async function POST(request: NextRequest) {
  // Safe diagnostics: never log the payload, signature values, or credentials.
  // This confirms whether PayPal actually reaches the deployed route.
  console.info("[payments:webhook] request received", {
    hasPaypalTransmissionId: request.headers.has("paypal-transmission-id"),
    hasPaypalTransmissionSig: request.headers.has("paypal-transmission-sig"),
    hasStripeSignature: request.headers.has("stripe-signature"),
    contentLength: request.headers.get("content-length") ?? null,
  });

  /*
   * Payment provider webhooks are server-to-server requests.
   * They do not use the browser CSRF flow.
   *
   * Authenticity is established by the payment provider's
   * webhook signature verification below.
   *
   * Rate limiting is still applied because this endpoint is
   * publicly reachable.
   */
  const limited = await rateLimitAsync(
    clientKey(request, "payments:webhook"),
    120,
    60_000,
  );

  if (!limited.allowed) {
    return NextResponse.json(
      {
        error: "RATE_LIMITED",
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(limited.retryAfter),
        },
      },
    );
  }

  // Bound the payload before reading it: provider events are a few KB.
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: "PAYLOAD_TOO_LARGE" }, { status: 413 });
  }

  const rawBody = await request.text();
  if (rawBody.length > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: "PAYLOAD_TOO_LARGE" }, { status: 413 });
  }

  const signature =
    request.headers.get("stripe-signature") ||
    request.headers.get("x-payment-signature") ||
    "";

  const provider = new ConfiguredPaymentProvider();

  const webhookHeaders = Object.fromEntries(
    Array.from(request.headers.entries()).filter(
      ([key]) => key.toLowerCase().startsWith("paypal-"),
    ),
  );

  console.info("[payments:webhook] verification started", {
    provider: provider.name,
    paypalEnvironment: process.env.PAYPAL_ENVIRONMENT || "unset",
    paypalWebhookIdConfigured: Boolean(process.env.PAYPAL_WEBHOOK_ID),
    paypalClientIdConfigured: Boolean(process.env.PAYPAL_CLIENT_ID),
    paypalClientSecretConfigured: Boolean(process.env.PAYPAL_CLIENT_SECRET),
    paypalHeaderCount: Object.keys(webhookHeaders).length,
  });

  let signatureValid = false;
  try {
    signatureValid = await provider.verifyWebhook(
      rawBody,
      signature,
      webhookHeaders,
    );
  } catch (error) {
    // Verification itself failed (provider unreachable, misconfiguration). Answer 503 so the
    // provider retries later; never treat an unverifiable event as verified.
    await logSystemError("payments:webhook-verify", error, { statusCode: 503 });
    return NextResponse.json({ error: "WEBHOOK_VERIFICATION_UNAVAILABLE" }, { status: 503 });
  }

  if (!signatureValid) {
    console.warn("[payments:webhook] signature rejected", {
      provider: provider.name,
      paypalEnvironment: process.env.PAYPAL_ENVIRONMENT || "unset",
      paypalWebhookIdConfigured: Boolean(process.env.PAYPAL_WEBHOOK_ID),
      paypalHeaderNames: Object.keys(webhookHeaders),
    });
    return NextResponse.json(
      {
        error: "INVALID_SIGNATURE",
      },
      {
        status: 401,
      },
    );
  }

  try {
    const parsed = JSON.parse(rawBody);

    let event =
      provider.name === "stripe"
        ? normalizeStripe(parsed)
        : provider.name === "paypal"
          ? normalizePayPal(parsed)
          : normalizeGeneric(parsed);

    if (
      event &&
      provider.name === "stripe" &&
      event.status === "REFUNDED" &&
      !event.orderId &&
      event.providerOrderId
    ) {
      const resolvedReference =
        await resolveStripePaymentIntentReference(
          event.providerOrderId,
        );

      if (resolvedReference) {
        event = {
          ...event,
          orderId: resolvedReference,
        };
      }
    }

    // PayPal capture webhooks commonly identify the PayPal order in
    // supplementary_data.related_ids.order_id, while wallet deposits are
    // keyed by our internal WalletDeposit.id. Resolve that provider order ID
    // to the local deposit before dispatching the event.
    if (event && provider.name === "paypal" && event.orderId) {
      const localDeposit = await db.walletDeposit.findUnique({
        where: { id: event.orderId },
        select: { id: true },
      });
      if (!localDeposit) {
        const providerDeposit = await db.walletDeposit.findFirst({
          where: {
            provider: "paypal",
            providerPaymentId: event.orderId,
          },
          select: { id: true },
        });
        if (providerDeposit) {
          event = { ...event, orderId: providerDeposit.id };
        }
      }
    }

    if (
      !event ||
      !event.orderId ||
      !Number.isInteger(event.amountCents) ||
      event.amountCents < 0
    ) {
      return NextResponse.json(
        {
          error: "INVALID_EVENT",
        },
        {
          status: 400,
        },
      );
    }

    const apiAccessPurchase = await db.apiAccessPurchase.findUnique({ where: { id: event.orderId }, select: { id: true } });
    if (apiAccessPurchase) {
      await processApiAccessPaymentWebhook(event);
      return NextResponse.json({ ok: true, type: "API_ACCESS" });
    }

    /*
     * VIP checkout uses VipSubscription.id as the
     * provider reference. Normal store checkout uses
     * Order.id. Detect VIP before entering the store
     * transaction so an otherwise valid VIP payment is
     * never treated as ORDER_NOT_FOUND.
     */
    const vipSubscription =
      await db.vipSubscription.findUnique({
        where: {
          id: event.orderId,
        },
        select: {
          id: true,
        },
      });

    if (vipSubscription) {
      const rawRecord =
        event.raw &&
        typeof event.raw === "object" &&
        !Array.isArray(event.raw)
          ? (event.raw as Record<string, unknown>)
          : null;

      const providerEventId =
        typeof rawRecord?.id === "string"
          ? rawRecord.id
          : undefined;

      await processVipPaymentWebhook({
        subscriptionId: vipSubscription.id,
        provider: event.provider,
        paymentId: event.paymentId,
        status: event.status,
        amountCents: event.amountCents,
        currency: event.currency,
        providerEventId,
        raw: event.raw,
      });

      return NextResponse.json({
        ok: true,
        type: "VIP",
      });
    }

    const walletDepositHandled = await processWalletDepositWebhook(event);
    if (walletDepositHandled) {
      return NextResponse.json({ ok: true, type: "WALLET_DEPOSIT" });
    }

    await db.$transaction(
      async (
        transaction: Prisma.TransactionClient,
      ) => {
        // Serialize every provider event (and any wallet checkout) for this
        // order. Without the lock two concurrent duplicate webhooks both read
        // the order as unpaid, and one of them then fails on the unique
        // payment index after doing all of the work.
        await transaction.$queryRaw(
          Prisma.sql`SELECT "id" FROM "Order" WHERE "id" = ${event.orderId} FOR UPDATE`,
        );

        const order =
          await transaction.order.findUnique({
            where: {
              id: event.orderId,
            },
            include: {
              items: {
                include: {
                  product: true,
                },
              },
            },
          });

        if (!order) {
          throw new Error("ORDER_NOT_FOUND");
        }

        /*
         * Successful payments must exactly match the order total.
         */
        if (
          (event.status === "SUCCEEDED" ||
            event.status === "REFUNDED") &&
          event.amountCents !== order.totalCents
        ) {
          // Store refunds are currently modeled as full-order refunds.
          // Partial provider refunds must never trigger full entitlement,
          // owner-revenue, or points reversal.
          throw new Error(
            event.status === "REFUNDED"
              ? "PARTIAL_REFUND_NOT_SUPPORTED"
              : "PAYMENT_AMOUNT_MISMATCH",
          );
        }

        // A signed payment event must also match the order currency.
        // Amounts alone are insufficient because the same cents value can
        // represent different currencies.
        const orderCurrency = order.currency.toUpperCase();
        const eventCurrency = event.currency?.toUpperCase();
        if (!eventCurrency || eventCurrency !== orderCurrency) {
          throw new Error("PAYMENT_CURRENCY_MISMATCH");
        }

        const existing =
          await transaction.payment.findUnique({
            where: {
              provider_providerPaymentId: {
                provider: event.provider,
                providerPaymentId:
                  event.paymentId,
              },
            },
          });

        /*
         * Payment events can arrive out of order. Once an order has a
         * terminal successful/refunded state, a late FAILED/SUCCEEDED event
         * must never move it backwards or reactivate a refunded order.
         */
        if (
          event.status === "FAILED" &&
          (order.paymentStatus === "SUCCEEDED" ||
            order.paymentStatus === "REFUNDED")
        ) {
          return;
        }

        if (
          event.status === "SUCCEEDED" &&
          order.paymentStatus === "REFUNDED"
        ) {
          return;
        }

        /*
         * The order was already paid by a different payment (for example from
         * the wallet while a card checkout was still open). Fulfilling it again
         * would deliver a second set of keys and book revenue twice, so the
         * extra payment is only recorded for follow-up (refund) and not applied.
         */
        if (
          event.status === "SUCCEEDED" &&
          !existing &&
          order.paymentStatus === "SUCCEEDED"
        ) {
          await transaction.auditLog.create({
            data: {
              action: "DUPLICATE_PAYMENT_FOR_PAID_ORDER",
              entityType: "Order",
              entityId: order.id,
              metadata: {
                provider: event.provider,
                paymentId: event.paymentId,
                amountCents: event.amountCents,
                currency: event.currency ?? null,
                orderPaidWith: order.paymentProvider ?? null,
                action: "MANUAL_REFUND_REQUIRED",
              },
            },
          });
          return;
        }

        /*
         * A successful payment was already fully processed.
         * Ignore duplicate success webhooks.
         */
        if (
          existing?.status === "SUCCEEDED" &&
          event.status === "SUCCEEDED"
        ) {
          return;
        }

        /*
         * A refund was already fully processed.
         * Ignore duplicate refund webhooks.
         */
        if (
          (existing?.status === "REFUNDED" ||
            order.paymentStatus === "REFUNDED") &&
          event.status === "REFUNDED"
        ) {
          return;
        }

        if (existing) {
          await transaction.payment.update({
            where: {
              id: existing.id,
            },
            data: {
              status: event.status,
              rawEvent:
                event.raw as object,
            },
          });
        } else {
          await transaction.payment.create({
            data: {
              orderId: event.orderId,
              provider: event.provider,
              providerPaymentId:
                event.paymentId,
              status: event.status,
              amountCents:
                event.amountCents,
              currency:
                event.currency ||
                order.currency,
              rawEvent:
                event.raw as object,
            },
          });
        }

        if (event.status === "SUCCEEDED") {
          /*
           * Deliver the digital keys first.
           * Everything is inside the same DB transaction.
           */
          await deliverGameKeys(
            transaction,
            order,
          );

          await transaction.order.update({
            where: {
              id: order.id,
            },
            data: {
              paymentStatus: "SUCCEEDED",
              status: "COMPLETED",
              paymentProvider:
                event.provider,
            },
          });

          /*
           * Owner revenue.
           */
          await recordOwnerRevenue(
            transaction,
            order,
            event.provider,
            event.paymentId,
          );

          /*
           * Owner purchase points.
           * Default: 1000 points.
           */
          await rewardOwnerPoints(
            transaction,
            order,
            event.provider,
            event.paymentId,
          );

          await rewardBuyerPoints(
            transaction,
            order,
            event.provider,
            event.paymentId,
          );

          /*
           * User notification.
           */
          await createPurchaseNotification(
            transaction,
            order,
            event.provider,
            event.paymentId,
          );

          /*
           * Referral qualification.
           */
          await qualifyReferralOnFirstOrder(
            transaction,
            order.userId,
          );
        } else if (
          event.status === "REFUNDED"
        ) {
          await transaction.order.update({
            where: {
              id: order.id,
            },
            data: {
              paymentStatus: "REFUNDED",
              status: "REFUNDED",
            },
          });

          /*
           * Revoke delivered digital keys.
           */
          await transaction.digitalKey.updateMany({
            where: {
              orderItemId: {
                in: order.items.map(
                  (item: WebhookOrder["items"][number]) =>
                    item.id,
                ),
              },
              status:
                DigitalKeyStatus.DELIVERED,
            },
            data: {
              status:
                DigitalKeyStatus.REVOKED,
              revokedAt: new Date(),
            },
          });

          /*
           * Revoke game entitlements.
           */
          await revokeEntitlementsForRefund(
            transaction,
            order.userId,
            order.items.map(
              (item: WebhookOrder["items"][number]) => item.id,
            ),
          );

          /*
           * Reverse owner revenue.
           */
          await refundOwnerRevenue(
            transaction,
            order,
            event.provider,
            event.paymentId,
          );

          /*
           * Reverse owner purchase points.
           */
          await refundOwnerPoints(
            transaction,
            order,
            event.provider,
            event.paymentId,
          );

          await refundBuyerPoints(
            transaction,
            order,
            event.provider,
            event.paymentId,
          );
        } else {
          await transaction.order.update({
            where: {
              id: order.id,
            },
            data: {
              paymentStatus: "FAILED",
              status: "FAILED",
            },
          });
        }
      },
    );

    return NextResponse.json({
      ok: true,
    });
  } catch (error) {
    const message =
      publicErrorCode(error, "WEBHOOK_PROCESSING_FAILED");

    // Fulfillment/accounting failures are retryable. Returning 4xx here can
    // cause providers to stop retrying a signed payment event even though the
    // database transaction was rolled back and the order still needs fulfillment.
    const retryableMessages = new Set([
      "OUT_OF_STOCK",
      "DIGITAL_KEYS_OUT_OF_STOCK",
      "DIGITAL_KEY_ALREADY_CLAIMED",
      "OWNER_USD_BALANCE_INSUFFICIENT_FOR_REFUND",
      "OWNER_ACCOUNT_NOT_FOUND",
      "OWNER_WALLET_NOT_FOUND",
      "WALLET_NOT_FOUND",
      "WALLET_BALANCE_CHANGED",
      "API_ACCESS_PURCHASE_NOT_FOUND",
    ]);

    // A signed event whose body is not valid JSON can never succeed: 400 (no retry loop).
    // Any UNEXPECTED failure (database down, bug) is masked as WEBHOOK_PROCESSING_FAILED and
    // must stay retryable (500), otherwise a paid order could be dropped by the provider.
    const status =
      error instanceof SyntaxError
        ? 400
        : message === "ORDER_NOT_FOUND"
          ? 404
          : retryableMessages.has(message)
            ? 503
            : message === "WEBHOOK_PROCESSING_FAILED"
              ? 500
              : 400;

    await logSystemError(
      "payments:webhook",
      error,
      {
        statusCode: status,
      },
    );

    return NextResponse.json(
      {
        error: message,
      },
      {
        status,
      },
    );
  }
}
