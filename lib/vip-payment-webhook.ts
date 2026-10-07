import {
  PaymentStatus,
  Prisma,
  VipSubscriptionEventType,
  VipSubscriptionStatus,
} from "@prisma/client";

import { db } from "@/lib/prisma";

import {
  activateVipSubscription,
} from "@/lib/vip-subscriptions";

export type VipPaymentWebhookInput = {
  subscriptionId: string;
  provider: string;
  paymentId: string;
  status:
    | "SUCCEEDED"
    | "FAILED"
    | "REFUNDED";
  amountCents: number;
  currency?: string;
  providerEventId?: string;
  raw: unknown;
};

function validateId(
  value: string,
  name: string,
) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0
  ) {
    throw new Error(
      `${name}_REQUIRED`,
    );
  }
}

function validateAmount(
  value: number,
) {
  if (
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new Error(
      "INVALID_PAYMENT_AMOUNT",
    );
  }
}

/**
 * Prisma Json fields can contain any valid JSON
 * value, not necessarily an object.
 *
 * This helper safely converts an unknown JSON value
 * into an object before metadata is merged.
 */
function jsonObject(
  value: unknown,
): Record<string, Prisma.InputJsonValue> {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    return value as Record<
      string,
      Prisma.InputJsonValue
    >;
  }

  return {};
}

/**
 * Safely merge existing Prisma JSON metadata
 * with additional metadata.
 */
function mergeMetadata(
  existing: unknown,
  additional: Record<
    string,
    Prisma.InputJsonValue
  >,
): Prisma.InputJsonValue {
  return {
    ...jsonObject(existing),
    ...additional,
  };
}

async function createEvent(
  tx: Prisma.TransactionClient,
  input: {
    subscriptionId: string;
    type: VipSubscriptionEventType;
    provider: string;
    providerEventId?: string;
    metadata?: Prisma.InputJsonValue;
  },
) {
  /*
   * Provider event IDs are idempotent.
   *
   * A payment provider may deliver the same
   * webhook more than once.
   */
  if (input.providerEventId) {
    const existing =
      await tx.vipSubscriptionEvent.findFirst({
        where: {
          provider:
            input.provider,
          providerEventId:
            input.providerEventId,
        },
      });

    if (existing) {
      return existing;
    }
  }

  return tx.vipSubscriptionEvent.create({
    data: {
      subscriptionId:
        input.subscriptionId,
      type:
        input.type,
      provider:
        input.provider,
      providerEventId:
        input.providerEventId,
      metadata:
        input.metadata,
    },
  });
}

async function markVipPaymentFailed(
  input: VipPaymentWebhookInput,
) {
  return db.$transaction(
    async (tx) => {
      const subscription =
        await tx.vipSubscription.findUnique({
          where: {
            id:
              input.subscriptionId,
          },
          include: {
            plan: true,
            purchase: true,
          },
        });

      if (!subscription) {
        throw new Error(
          "VIP_SUBSCRIPTION_NOT_FOUND",
        );
      }

      /*
       * Ignore a late FAILED webhook if the
       * subscription has already been activated.
       *
       * This protects a successful payment from
       * being downgraded by an out-of-order event.
       */
      if (
        subscription.status ===
          VipSubscriptionStatus.ACTIVE ||
        subscription.status ===
          VipSubscriptionStatus.EXPIRED
      ) {
        return {
          ignored: true,
          reason:
            "VIP_SUBSCRIPTION_ALREADY_PROCESSED",
          subscription,
        };
      }

      if (
        input.providerEventId
      ) {
        const existingEvent =
          await tx.vipSubscriptionEvent.findFirst({
            where: {
              provider:
                input.provider,
              providerEventId:
                input.providerEventId,
            },
          });

        if (existingEvent) {
          return {
            ignored: true,
            reason:
              "DUPLICATE_PROVIDER_EVENT",
            subscription,
          };
        }
      }

      if (subscription.purchase) {
        await tx.vipPurchase.update({
          where: {
            id:
              subscription.purchase.id,
          },
          data: {
            status:
              PaymentStatus.FAILED,

            metadata:
              mergeMetadata(
                subscription.purchase.metadata,
                {
                  webhookStatus:
                    "FAILED",

                  paymentId:
                    input.paymentId,

                  provider:
                    input.provider,

                  processedAt:
                    new Date().toISOString(),

                  raw:
                    jsonObject(
                      input.raw,
                    ),
                },
              ),
          },
        });
      }

      const updated =
        await tx.vipSubscription.update({
          where: {
            id:
              subscription.id,
          },
          data: {
            status:
              VipSubscriptionStatus.PAYMENT_FAILED,

            updatedAt:
              new Date(),
          },
          include: {
            plan: true,
          },
        });

      await createEvent(
        tx,
        {
          subscriptionId:
            subscription.id,

          type:
            VipSubscriptionEventType.PAYMENT_FAILED,

          provider:
            input.provider,

          providerEventId:
            input.providerEventId,

          metadata: {
            paymentId:
              input.paymentId,

            amountCents:
              input.amountCents,

            currency:
              input.currency ??
              subscription.plan.currency,

            planCode:
              subscription.plan.code,

            raw:
              jsonObject(
                input.raw,
              ),
          },
        },
      );

      await tx.notification.create({
        data: {
          userId:
            subscription.userId,

          type:
            "VIP_PAYMENT_FAILED",

          title:
            "فشل دفع VIP",

          body:
            `تعذر إتمام عملية شراء ${subscription.plan.nameAr}.`,

          metadata: {
            subscriptionId:
              subscription.id,

            planCode:
              subscription.plan.code,

            paymentId:
              input.paymentId,

            provider:
              input.provider,
          },
        },
      });

      return {
        ignored: false,
        subscription:
          updated,
      };
    },
    {
      isolationLevel:
        Prisma.TransactionIsolationLevel.Serializable,
    },
  );
}

async function refundVipPayment(
  input: VipPaymentWebhookInput,
) {
  return db.$transaction(
    async (tx) => {
      const subscription =
        await tx.vipSubscription.findUnique({
          where: {
            id:
              input.subscriptionId,
          },
          include: {
            plan: true,
            purchase: true,
          },
        });

      if (!subscription) {
        throw new Error(
          "VIP_SUBSCRIPTION_NOT_FOUND",
        );
      }

      /*
       * VIP currently supports full refunds.
       * Partial refunds must not silently revoke
       * a subscription incorrectly.
       */
      if (
        input.amountCents !==
        subscription.plan.priceCents
      ) {
        throw new Error(
          "VIP_PARTIAL_REFUND_UNSUPPORTED",
        );
      }

      if (
        !input.currency ||
        input.currency.toUpperCase() !==
          subscription.plan.currency.toUpperCase()
      ) {
        throw new Error(
          "VIP_REFUND_CURRENCY_MISMATCH",
        );
      }

      if (
        subscription.purchase &&
        subscription.purchase.status ===
          PaymentStatus.REFUNDED
      ) {
        return {
          ignored: true,
          reason:
            "VIP_REFUND_ALREADY_PROCESSED",
          subscription,
        };
      }

      if (
        input.providerEventId
      ) {
        const existingEvent =
          await tx.vipSubscriptionEvent.findFirst({
            where: {
              provider:
                input.provider,
              providerEventId:
                input.providerEventId,
            },
          });

        if (existingEvent) {
          return {
            ignored: true,
            reason:
              "DUPLICATE_PROVIDER_EVENT",
            subscription,
          };
        }
      }

      if (subscription.purchase) {
        await tx.vipPurchase.update({
          where: {
            id:
              subscription.purchase.id,
          },
          data: {
            status:
              PaymentStatus.REFUNDED,

            metadata:
              mergeMetadata(
                subscription.purchase.metadata,
                {
                  webhookStatus:
                    "REFUNDED",

                  refundPaymentId:
                    input.paymentId,

                  refundedAt:
                    new Date().toISOString(),

                  raw:
                    jsonObject(
                      input.raw,
                    ),
                },
              ),
          },
        });
      }

      const updated =
        await tx.vipSubscription.update({
          where: {
            id:
              subscription.id,
          },
          data: {
            status:
              VipSubscriptionStatus.REFUNDED,




            updatedAt:
              new Date(),
          },
          include: {
            plan: true,
          },
        });

      await createEvent(
        tx,
        {
          subscriptionId:
            subscription.id,

          type:
            VipSubscriptionEventType.REFUNDED,

          provider:
            input.provider,

          providerEventId:
            input.providerEventId,

          metadata: {
            paymentId:
              input.paymentId,

            amountCents:
              input.amountCents,

            currency:
              input.currency ??
              subscription.plan.currency,

            planCode:
              subscription.plan.code,

            raw:
              jsonObject(
                input.raw,
              ),
          },
        },
      );

      await tx.notification.create({
        data: {
          userId:
            subscription.userId,

          type:
            "VIP_REFUNDED",

          title:
            "تم إرجاع دفعة VIP",

          body:
            `تم إرجاع دفعة ${subscription.plan.nameAr} وإيقاف مزايا VIP المرتبطة بها.`,

          metadata: {
            subscriptionId:
              subscription.id,

            planCode:
              subscription.plan.code,

            paymentId:
              input.paymentId,

            provider:
              input.provider,
          },
        },
      });

      return {
        ignored: false,
        subscription:
          updated,
      };
    },
    {
      isolationLevel:
        Prisma.TransactionIsolationLevel.Serializable,
    },
  );
}

/**
 * Handles a verified payment webhook that belongs
 * to a VIP subscription instead of a normal store Order.
 *
 * IMPORTANT:
 * This function is called ONLY after the existing
 * payment provider webhook signature has been verified.
 */
export async function processVipPaymentWebhook(
  input: VipPaymentWebhookInput,
) {
  validateId(
    input.subscriptionId,
    "VIP_SUBSCRIPTION_ID",
  );

  validateId(
    input.provider,
    "PROVIDER",
  );

  validateId(
    input.paymentId,
    "PAYMENT_ID",
  );

  validateAmount(
    input.amountCents,
  );

  if (
    input.status === "FAILED"
  ) {
    return markVipPaymentFailed(
      input,
    );
  }

  if (
    input.status === "REFUNDED"
  ) {
    return refundVipPayment(
      input,
    );
  }

  /*
   * Before activation, verify that the
   * subscription really exists and that the
   * amount/currency are authoritative.
   */
  const subscription =
    await db.vipSubscription.findUnique({
      where: {
        id:
          input.subscriptionId,
      },
      include: {
        plan: true,
        purchase: true,
      },
    });

  if (!subscription) {
    throw new Error(
      "VIP_SUBSCRIPTION_NOT_FOUND",
    );
  }

  if (
    subscription.purchase &&
    subscription.purchase.providerPaymentId.startsWith("pending_vip_") === false &&
    subscription.purchase.providerPaymentId !== input.paymentId &&
    subscription.purchase.status !== PaymentStatus.SUCCEEDED
  ) {
    throw new Error(
      "VIP_PAYMENT_ID_MISMATCH",
    );
  }

  /*
   * A successful webhook must match the
   * server-side VIP plan price exactly.
   */
  if (
    input.amountCents !==
    subscription.plan.priceCents
  ) {
    throw new Error(
      "VIP_PAYMENT_AMOUNT_MISMATCH",
    );
  }

  if (
    !input.currency ||
    input.currency.toUpperCase() !==
      subscription.plan.currency.toUpperCase()
  ) {
    throw new Error(
      "VIP_PAYMENT_CURRENCY_MISMATCH",
    );
  }

  /*
   * A normal first purchase must still be
   * pending or payment-failed.
   *
   * An already-active subscription is never
   * activated twice.
   */
  if (
    subscription.status ===
      VipSubscriptionStatus.ACTIVE
  ) {
    if (
      subscription.paymentId ===
      input.paymentId
    ) {
      return {
        reused: true,
        subscription,
      };
    }

    throw new Error(
      "VIP_SUBSCRIPTION_ALREADY_ACTIVE",
    );
  }

  if (
    subscription.status ===
      VipSubscriptionStatus.REFUNDED ||
    subscription.status ===
      VipSubscriptionStatus.CANCELED
  ) {
    throw new Error(
      "VIP_SUBSCRIPTION_NOT_ACTIVATABLE",
    );
  }

  return activateVipSubscription({
    subscriptionId:
      input.subscriptionId,

    provider:
      input.provider,

    paymentId:
      input.paymentId,

    amountCents:
      input.amountCents,

    currency:
      input.currency,

    providerEventId:
      input.providerEventId,

    metadata:
      {
        webhookStatus:
          input.status,

        webhookProcessedAt:
          new Date().toISOString(),

        raw:
          jsonObject(
            input.raw,
          ),
      },
  });
}
