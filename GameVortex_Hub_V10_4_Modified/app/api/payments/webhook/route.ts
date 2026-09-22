import { NextRequest, NextResponse } from "next/server";
import {
  DeliveryType,
  DigitalKeyStatus,
  LedgerType,
  Prisma,
  ProductKind,
} from "@prisma/client";
import { db } from "@/lib/prisma";
import { ConfiguredPaymentProvider } from "@/lib/payments";
import { qualifyReferralOnFirstOrder } from "@/lib/referrals";
import { rateLimitAsync, clientKey } from "@/lib/security";
import { logSystemError } from "@/lib/observability";
import { processVipPaymentWebhook } from "@/lib/vip-payment-webhook";
import {
  computeBuyerPurchasePoints,
  FREE_PRODUCT_POINTS,
} from "@/lib/points-economy";

export const runtime = "nodejs";

type NormalizedEvent = {
  provider: string;
  paymentId: string;
  orderId: string;
  status: "SUCCEEDED" | "FAILED" | "REFUNDED";
  amountCents: number;
  currency?: string;
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

  if (!raw) {
    return 1000;
  }

  const parsed = Number(raw);

  if (!Number.isInteger(parsed) || parsed < 0) {
    return 1000;
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

  if (!orderId) {
    return null;
  }

  const amountCents = Number(
    object?.amount_total ??
      object?.amount ??
      object?.amount_refunded ??
      -1,
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

    const availableKeys =
      await transaction.digitalKey.findMany({
        where: {
          productId: item.productId,
          status: DigitalKeyStatus.AVAILABLE,
        },
        orderBy: {
          createdAt: "asc",
        },
        take: item.quantity,
        select: {
          id: true,
        },
      });

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

/*
 * Master Task Plan Section 3, item 5 — نظام النقاط للمنتجات (المشتري).
 * Additive to the existing rewardOwnerPoints() below: does not change
 * owner reward behavior at all, only adds the buyer-side reward that
 * did not exist before. Runs inside the same DB transaction as the
 * rest of the order-completion flow, so it can never be credited
 * without the order itself being marked COMPLETED (and vice versa).
 */
async function awardBuyerPoints(
  transaction: Prisma.TransactionClient,
  order: {
    id: string;
    userId: string;
    totalCents: number;
  },
  provider: string,
  paymentId: string,
) {
  const points = computeBuyerPurchasePoints(
    order.totalCents,
  );

  if (points <= 0) {
    return;
  }

  const idempotencyKey =
    `buyer-points:${order.id}:${provider}:${paymentId}`;

  const existing =
    await transaction.pointLedger.findUnique({
      where: { idempotencyKey },
    });

  if (existing) {
    return;
  }

  await transaction.user.update({
    where: { id: order.userId },
    data: {
      points: {
        increment: points,
      },
    },
  });

  const user = await transaction.user.findUnique({
    where: { id: order.userId },
    select: { points: true },
  });

  if (!user) {
    throw new Error("BUYER_ACCOUNT_NOT_FOUND");
  }

  await transaction.pointLedger.create({
    data: {
      userId: order.userId,
      type: "CREDIT",
      amount: points,
      balanceAfter: user.points,
      reason:
        order.totalCents > 0
          ? "PURCHASE_REWARD"
          : "FREE_PRODUCT_REWARD",
      sourceId: order.id,
      idempotencyKey,
      metadata: {
        orderId: order.id,
        provider,
        paymentId,
        totalCents: order.totalCents,
        isFree: order.totalCents === 0,
        rewardConfig:
          order.totalCents === 0
            ? {
                type: "flat",
                points: FREE_PRODUCT_POINTS.USER,
              }
            : { type: "scaled" },
      },
    },
  });
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

  const owner = await transaction.user.findFirst({
    where: {
      role: "SUPER_ADMIN",
    },
    select: {
      id: true,
    },
  });

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
  const owner = await transaction.user.findFirst({
    where: {
      role: "SUPER_ADMIN",
    },
    select: {
      id: true,
    },
  });

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

  const usdAmount = new Prisma.Decimal(
    order.totalCents,
  ).div(100);

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
      where: {
        idempotencyKey: refundIdempotencyKey,
      },
    });

  if (existingRefund) {
    return;
  }

  const saleLedger =
    await transaction.ownerLedger.findUnique({
      where: {
        idempotencyKey:
          `sale-revenue:${order.id}:${provider}:${paymentId}`,
      },
    });

  if (!saleLedger) {
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

  await transaction.ownerLedger.create({
    data: {
      walletId: wallet.id,
      type: LedgerType.REFUND,
      points: 0,
      usdAmount: saleLedger.usdAmount
        ? saleLedger.usdAmount.neg()
        : null,
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

  const saleLedger =
    await transaction.ownerLedger.findUnique({
      where: {
        idempotencyKey:
          `sale-points:${order.id}:${provider}:${paymentId}`,
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

export async function POST(request: NextRequest) {
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

  const rawBody = await request.text();

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

  if (
    !(await provider.verifyWebhook(
      rawBody,
      signature,
      webhookHeaders,
    ))
  ) {
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

    const event =
      provider.name === "stripe"
        ? normalizeStripe(parsed)
        : provider.name === "paypal"
          ? normalizePayPal(parsed)
          : normalizeGeneric(parsed);

    if (
      !event ||
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

    await db.$transaction(
      async (
        transaction: Prisma.TransactionClient,
      ) => {
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
          event.status === "SUCCEEDED" &&
          event.amountCents !== order.totalCents
        ) {
          throw new Error(
            "PAYMENT_AMOUNT_MISMATCH",
          );
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
          existing?.status === "REFUNDED" &&
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

          /*
           * Buyer purchase points (Section 3, item 5).
           */
          await awardBuyerPoints(
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
          await transaction.entitlement.updateMany({
            where: {
              userId: order.userId,
              gameId: {
                in: order.items.map(
                  (item: WebhookOrder["items"][number]) =>
                    item.product.gameId,
                ),
              },
            },
            data: {
              revokedAt: new Date(),
            },
          });

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
      error instanceof Error
        ? error.message
        : "WEBHOOK_PROCESSING_FAILED";

    const status =
      message === "ORDER_NOT_FOUND"
        ? 404
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
