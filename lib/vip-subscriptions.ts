import {
  Prisma,
  VipSubscriptionEventType,
  VipSubscriptionStatus,
  PaymentStatus,
} from "@prisma/client";

import { db } from "@/lib/prisma";
import { runSerializable } from "@/lib/db-serializable";
import {
  addMonthsUtc,
} from "@/lib/vip-plans";

type ActivateVipInput = {
  subscriptionId: string;
  provider: string;
  paymentId: string;
  amountCents: number;
  currency?: string;
  providerEventId?: string;
  metadata?: Prisma.InputJsonValue;
};

type RenewVipInput = {
  subscriptionId: string;
  provider: string;
  paymentId: string;
  amountCents: number;
  currency?: string;
  providerEventId?: string;
  renewalFromSubscriptionId?: string;
  metadata?: Prisma.InputJsonValue;
};

async function grantVipGvc(
  tx: Prisma.TransactionClient,
  userId: string,
  amount: number,
  idempotencyKey: string,
) {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("INVALID_VIP_GVC_GRANT");
  if (amount === 0) return;
  const existing = await tx.aiCreditLedger.findUnique({ where: { idempotencyKey } });
  if (existing) return;
  await tx.aiCreditBalance.upsert({
    where: { userId },
    create: { userId, gvcBalance: amount },
    update: { gvcBalance: { increment: amount } },
  });
  await tx.aiCreditLedger.create({
    data: {
      userId,
      kind: "GVC",
      delta: amount,
      reason: "VIP_GVC_GRANT",
      referenceId: idempotencyKey,
      idempotencyKey,
    },
  });
}

/**
 * Takes back the GVC that a payment granted when that payment is refunded.
 *
 * Only what is still in the balance can be taken (the user may already have
 * spent part of it), the balance can never go below zero, and the key makes a
 * repeated refund event a no-op.
 */
export async function revokeVipGvcInTransaction(
  tx: Prisma.TransactionClient,
  input: { userId: string; subscriptionId: string; paymentId: string | null },
): Promise<number> {
  if (!input.paymentId) return 0;

  const grantKeys = [
    `vip:activation:${input.subscriptionId}:${input.paymentId}`,
    `vip:renewal:${input.subscriptionId}:${input.paymentId}`,
  ];
  const grant = await tx.aiCreditLedger.findFirst({
    where: { idempotencyKey: { in: grantKeys }, userId: input.userId, delta: { gt: 0 } },
  });
  if (!grant) return 0;

  const revokeKey = `vip:revoke:${grant.idempotencyKey}`;
  const already = await tx.aiCreditLedger.findUnique({ where: { idempotencyKey: revokeKey } });
  if (already) return Math.abs(already.delta);

  // Lock the balance row so a spend that is happening right now cannot slip
  // between reading the balance and taking the credits back.
  const rows = await tx.$queryRaw<Array<{ gvcBalance: number }>>(
    Prisma.sql`SELECT "gvcBalance" FROM "AiCreditBalance" WHERE "userId" = ${input.userId} FOR UPDATE`,
  );
  const balance = rows[0]?.gvcBalance ?? 0;
  const revoked = Math.min(balance, grant.delta);

  if (revoked > 0) {
    await tx.aiCreditBalance.update({
      where: { userId: input.userId },
      data: { gvcBalance: { decrement: revoked } },
    });
  }
  // Written even when nothing was left to take, so the refund is recorded and
  // replaying the event cannot take credits that were bought later.
  await tx.aiCreditLedger.create({
    data: {
      userId: input.userId,
      kind: "GVC",
      delta: -revoked,
      reason: "VIP_GVC_REFUND_REVOKE",
      referenceId: grant.idempotencyKey,
      idempotencyKey: revokeKey,
    },
  });
  return revoked;
}

type CancelVipInput = {
  subscriptionId: string;
  reason?: string;
  metadata?: Prisma.InputJsonValue;
};

function validateId(value: string, name: string) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0
  ) {
    throw new Error(`${name}_REQUIRED`);
  }
}

function validateAmount(value: number) {
  if (
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new Error("INVALID_PAYMENT_AMOUNT");
  }
}

function validateProvider(value: string) {
  validateId(value, "PROVIDER");

  if (value.length > 100) {
    throw new Error("INVALID_PROVIDER");
  }
}

function validatePaymentId(value: string) {
  validateId(value, "PAYMENT_ID");

  if (value.length > 255) {
    throw new Error("INVALID_PAYMENT_ID");
  }
}

function validateSubscriptionId(value: string) {
  validateId(value, "SUBSCRIPTION_ID");
}

function calculateExpiry(
  startedAt: Date,
  durationMonths: number | null,
): Date | null {
  if (durationMonths === null) {
    return null;
  }

  if (
    !Number.isInteger(durationMonths) ||
    durationMonths <= 0
  ) {
    throw new Error("INVALID_VIP_DURATION");
  }

  return addMonthsUtc(
    startedAt,
    durationMonths,
  );
}

async function createSubscriptionEvent(
  tx: Prisma.TransactionClient,
  input: {
    subscriptionId: string;
    type: VipSubscriptionEventType;
    provider?: string;
    providerEventId?: string;
    metadata?: Prisma.InputJsonValue;
  },
) {
  /*
   * Provider event IDs are unique when supplied.
   *
   * This protects the subscription engine against
   * duplicate webhook delivery.
   */
  if (input.providerEventId) {
    const existing =
      await tx.vipSubscriptionEvent.findFirst({
        where: {
          provider: input.provider,
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
      type: input.type,
      provider:
        input.provider,
      providerEventId:
        input.providerEventId,
      metadata:
        input.metadata,
    },
  });
}

async function notifyVipActivation(
  tx: Prisma.TransactionClient,
  userId: string,
  subscriptionId: string,
  plan: {
    code: string;
    nameAr: string;
    nameEn: string;
  },
  expiresAt: Date | null,
) {
  const expirationText =
    expiresAt
      ? expiresAt.toISOString()
      : "PERMANENT";

  const existing =
    await tx.notification.findFirst({
      where: {
        userId,
        type: "VIP_ACTIVATED",
        metadata: {
          path: [
            "subscriptionId",
          ],
          equals:
            subscriptionId,
        },
      },
      select: {
        id: true,
      },
    });

  /*
   * Do not create duplicate activation notifications
   * when the same webhook is delivered more than once.
   */
  if (existing) {
    return;
  }

  await tx.notification.create({
    data: {
      userId,
      type: "VIP_ACTIVATED",
      title:
        "تم تفعيل GameVortex VIP",
      body:
        `تم تفعيل ${plan.nameAr}.`,
      metadata: {
        planCode:
          plan.code,
        subscriptionId,
        expiration:
          expirationText,
      },
    },
  });
}

/**
 * A refunded or canceled subscription is closed. A late success event must
 * not bring it back to life (the refund already returned the money).
 */
function assertActivatableStatus(status: VipSubscriptionStatus) {
  if (
    status === VipSubscriptionStatus.REFUNDED ||
    status === VipSubscriptionStatus.CANCELED
  ) {
    throw new Error("VIP_SUBSCRIPTION_NOT_ACTIVATABLE");
  }
}

/**
 * The payment must match the amount/currency this checkout was created with
 * (VipPurchase), falling back to the plan when no purchase row exists.
 */
function assertPaymentMatchesCheckout(
  input: { amountCents: number; currency?: string },
  plan: { priceCents: number; currency: string },
  purchase: { amountCents: number; currency: string } | null,
) {
  const expectedAmount = purchase?.amountCents ?? plan.priceCents;
  const expectedCurrency = (purchase?.currency ?? plan.currency).toUpperCase();

  if (input.amountCents !== expectedAmount) {
    throw new Error("VIP_PAYMENT_AMOUNT_MISMATCH");
  }
  if (
    input.currency &&
    input.currency.toUpperCase() !== expectedCurrency
  ) {
    throw new Error("VIP_PAYMENT_CURRENCY_MISMATCH");
  }
}

/**
 * Activates a VIP subscription after the payment
 * has already been verified by the payment provider.
 *
 * IMPORTANT:
 * This function does NOT trust:
 * - browser price
 * - browser duration
 * - browser multiplier
 * - browser-facing VIP benefits
 *
 * Everything comes from the server-side VipPlan record.
 */
export async function activateVipSubscription(
  input: ActivateVipInput,
) {
  validateSubscriptionId(
    input.subscriptionId,
  );

  validateProvider(
    input.provider,
  );

  validatePaymentId(
    input.paymentId,
  );

  validateAmount(
    input.amountCents,
  );

  const now = new Date();

  return runSerializable(
    async (tx) => {
      const subscription =
        await tx.vipSubscription.findUnique({
          where: {
            id:
              input.subscriptionId,
          },
          include: {
            plan: true,
            user: {
              select: {
                id: true,
                role: true,
              },
            },
            purchase: true,
          },
        });

      if (!subscription) {
        throw new Error(
          "VIP_SUBSCRIPTION_NOT_FOUND",
        );
      }

      /*
       * Owner VIP is never activated through payment.
       */
      if (
        subscription.user.role ===
        "SUPER_ADMIN"
      ) {
        throw new Error(
          "OWNER_VIP_DOES_NOT_USE_PAYMENT",
        );
      }

      /*
       * Server-side price verification against what this checkout was
       * created for. An admin editing the plan price while a payment is open
       * must not turn a correct payment into a mismatch (money taken, no VIP).
       */
      assertPaymentMatchesCheckout(
        input,
        subscription.plan,
        subscription.purchase,
      );

      assertActivatableStatus(subscription.status);

      /*
       * Already active with the same payment:
       * return the current subscription instead
       * of granting credits twice.
       */
      if (
        subscription.status ===
          VipSubscriptionStatus.ACTIVE &&
        subscription.paymentId ===
          input.paymentId
      ) {
        return {
          reused: true,
          subscription,
        };
      }

      /*
       * A different payment cannot activate
       * an already-active subscription through
       * this function.
       *
       * Renewal must use renewVipSubscription().
       */
      if (
        subscription.status ===
        VipSubscriptionStatus.ACTIVE
      ) {
        throw new Error(
          "VIP_SUBSCRIPTION_ALREADY_ACTIVE",
        );
      }

      const startedAt =
        now;

      const expiresAt =
        calculateExpiry(
          startedAt,
          subscription.plan
            .durationMonths,
        );

      const updated =
        await tx.vipSubscription.update({
          where: {
            id:
              subscription.id,
          },
          data: {
            status:
              VipSubscriptionStatus.ACTIVE,

            startedAt,

            expiresAt,

            paymentId:
              input.paymentId,

            provider:
              input.provider,

            lastRewardAt:
              null,

            nextRewardAt:
              expiresAt,

            updatedAt:
              now,
          },
          include: {
            plan: true,
          },
        });

      await grantVipGvc(
        tx,
        subscription.userId,
        subscription.plan.gvcGrant,
        `vip:activation:${subscription.id}:${input.paymentId}`,
      );

      /*
       * Keep VipPurchase synchronized when
       * a purchase record already exists.
       */
      if (subscription.purchase) {
        await tx.vipPurchase.update({
          where: {
            id:
              subscription.purchase.id,
          },
          data: {
            provider:
              input.provider,

            providerPaymentId:
              input.paymentId,

            amountCents:
              input.amountCents,

            currency:
              input.currency ||
              subscription.plan.currency,

            status:
              PaymentStatus.SUCCEEDED,

            metadata:
              input.metadata,
          },
        });
      }

      await createSubscriptionEvent(
        tx,
        {
          subscriptionId:
            subscription.id,

          type:
            VipSubscriptionEventType.PAYMENT_SUCCEEDED,

          provider:
            input.provider,

          providerEventId:
            input.providerEventId,

          metadata: {
            paymentId:
              input.paymentId,

            amountCents:
              input.amountCents,

            planCode:
              subscription.plan.code,

            ...(input.metadata &&
            typeof input.metadata ===
              "object"
              ? input.metadata
              : {}),
          },
        },
      );

      await createSubscriptionEvent(
        tx,
        {
          subscriptionId:
            subscription.id,

          type:
            VipSubscriptionEventType.ACTIVATED,

          provider:
            input.provider,

          metadata: {
            planCode:
              subscription.plan.code,

            startedAt:
              startedAt.toISOString(),

            expiresAt:
              expiresAt?.toISOString() ??
              null,
          },
        },
      );

      await notifyVipActivation(
        tx,
        subscription.userId,
        subscription.id,
        {
          code:
            subscription.plan.code,

          nameAr:
            subscription.plan.nameAr,

          nameEn:
            subscription.plan.nameEn,
        },
        expiresAt,
      );

      return {
        reused: false,
        subscription:
          updated,
      };
    },
  );
}

/**
 * Renews an existing VIP subscription.
 *
 * Paid time is preserved:
 *
 * active + expiresAt in future
 *      -> new term starts at old expiresAt
 *
 * expired / canceled / refunded
 *      -> new term starts now
 *
 * Subscription benefits are reset to the purchased plan allowance.
 */
export async function renewVipSubscription(
  input: RenewVipInput,
) {
  validateSubscriptionId(
    input.subscriptionId,
  );

  if (input.renewalFromSubscriptionId) {
    validateSubscriptionId(
      input.renewalFromSubscriptionId,
    );
  }

  validateProvider(
    input.provider,
  );

  validatePaymentId(
    input.paymentId,
  );

  validateAmount(
    input.amountCents,
  );

  const now = new Date();

  return runSerializable(
    async (tx) => {
      const subscription =
        await tx.vipSubscription.findUnique({
          where: {
            id:
              input.subscriptionId,
          },
          include: {
            plan: true,
            user: {
              select: {
                id: true,
                role: true,
              },
            },
            purchase: true,
          },
        });

      if (!subscription) {
        throw new Error(
          "VIP_SUBSCRIPTION_NOT_FOUND",
        );
      }

      if (
        subscription.user.role ===
        "SUPER_ADMIN"
      ) {
        throw new Error(
          "OWNER_VIP_DOES_NOT_USE_PAYMENT",
        );
      }

      assertPaymentMatchesCheckout(
        input,
        subscription.plan,
        subscription.purchase,
      );

      /*
       * The same payment can never extend the subscription twice, even when
       * the provider did not send a stable event id.
       */
      if (
        subscription.status ===
          VipSubscriptionStatus.ACTIVE &&
        subscription.paymentId ===
          input.paymentId
      ) {
        return {
          reused: true,
          subscription,
        };
      }

      if (
        subscription.status ===
        VipSubscriptionStatus.ACTIVE
      ) {
        throw new Error(
          "VIP_SUBSCRIPTION_ALREADY_ACTIVE",
        );
      }

      assertActivatableStatus(subscription.status);

      /*
       * Duplicate renewal protection.
       */
      const existingEvent =
        input.providerEventId
          ? await tx.vipSubscriptionEvent.findFirst(
              {
                where: {
                  provider:
                    input.provider,
                  providerEventId:
                    input.providerEventId,
                },
              },
            )
          : null;

      if (existingEvent) {
        return {
          reused: true,
          subscription,
        };
      }

      let renewalSource:
        | {
            id: string;
            userId: string;
            status: VipSubscriptionStatus;
            plan: { code: string };
            expiresAt: Date | null;
          }
        | null = null;

      if (input.renewalFromSubscriptionId) {
        renewalSource =
          await tx.vipSubscription.findUnique({
            where: {
              id:
                input.renewalFromSubscriptionId,
            },
            select: {
              id: true,
              userId: true,
              status: true,
              plan: {
                select: {
                  code: true,
                },
              },
              expiresAt: true,
            },
          });

        if (!renewalSource) {
          throw new Error(
            "VIP_RENEWAL_SOURCE_NOT_FOUND",
          );
        }

        if (
          renewalSource.userId !==
          subscription.userId
        ) {
          throw new Error(
            "VIP_RENEWAL_SOURCE_MISMATCH",
          );
        }

        if (
          renewalSource.id ===
          subscription.id
        ) {
          throw new Error(
            "VIP_RENEWAL_SOURCE_INVALID",
          );
        }
      }

      /*
       * Only time that is still paid for and still active carries over. A
       * source that was refunded, canceled or expired in the meantime gives
       * nothing (otherwise a refunded plan could pass its time on).
       */
      const remainingMs =
        renewalSource &&
        renewalSource.status ===
          VipSubscriptionStatus.ACTIVE &&
        renewalSource.expiresAt &&
        renewalSource.expiresAt > now
          ? renewalSource.expiresAt.getTime() -
            now.getTime()
          : 0;

      const baseExpiry =
        calculateExpiry(
          now,
          subscription.plan
            .durationMonths,
        );

      const expiresAt =
        baseExpiry &&
        remainingMs > 0
          ? new Date(
              baseExpiry.getTime() +
                remainingMs,
            )
          : baseExpiry;

      const updated =
        await tx.vipSubscription.update({
          where: {
            id:
              subscription.id,
          },
          data: {
            status:
              VipSubscriptionStatus.ACTIVE,

            startedAt:
              now,

            expiresAt,

            paymentId:
              input.paymentId,

            provider:
              input.provider,

            nextRewardAt:
              expiresAt,
          },
          include: {
            plan: true,
          },
        });

      await grantVipGvc(
        tx,
        subscription.userId,
        subscription.plan.gvcGrant,
        `vip:renewal:${subscription.id}:${input.paymentId}`,
      );

      if (renewalSource) {
        await tx.vipSubscription.updateMany({
          where: {
            id:
              renewalSource.id,
            status:
              VipSubscriptionStatus.ACTIVE,
          },
          data: {
            status:
              VipSubscriptionStatus.CANCELED,
          },
        });

        await createSubscriptionEvent(
          tx,
          {
            subscriptionId:
              renewalSource.id,

            type:
              renewalSource.plan.code ===
              subscription.plan.code
                ? VipSubscriptionEventType.RENEWED
                : VipSubscriptionEventType.UPGRADED,

            metadata: {
              replacementSubscriptionId:
                subscription.id,

              paymentId:
                input.paymentId,

              newPlanCode:
                subscription.plan.code,

              remainingTimePreservedMs:
                remainingMs,
            },
          },
        );
      }

      await tx.vipPurchase.updateMany({
        where: {
          subscriptionId:
            subscription.id,
        },
        data: {
          provider:
            input.provider,

          providerPaymentId:
            input.paymentId,

          amountCents:
            input.amountCents,

          currency:
            input.currency ||
            subscription.plan.currency,

          status:
            PaymentStatus.SUCCEEDED,

          metadata:
            input.metadata,
        },
      });

      await createSubscriptionEvent(
        tx,
        {
          subscriptionId:
            subscription.id,

          type:
            VipSubscriptionEventType.PAYMENT_SUCCEEDED,

          provider:
            input.provider,

          providerEventId:
            input.providerEventId,

          metadata: {
            paymentId:
              input.paymentId,

            amountCents:
              input.amountCents,

            planCode:
              subscription.plan.code,

            renewalBase:
              now.toISOString(),
          },
        },
      );

      await createSubscriptionEvent(
        tx,
        {
          subscriptionId:
            subscription.id,

          type:
            renewalSource &&
            renewalSource.plan.code !==
              subscription.plan.code
              ? VipSubscriptionEventType.UPGRADED
              : VipSubscriptionEventType.RENEWED,

          provider:
            input.provider,

          metadata: {
            planCode:
              subscription.plan.code,

            expiresAt:
              expiresAt?.toISOString() ??
              null,

            renewalFromSubscriptionId:
              renewalSource?.id ?? null,
          },
        },
      );

      await tx.notification.create({
        data: {
          userId:
            subscription.userId,

          type:
            renewalSource &&
            renewalSource.plan.code !==
              subscription.plan.code
              ? "VIP_UPGRADED"
              : "VIP_RENEWED",

          title:
            renewalSource &&
            renewalSource.plan.code !==
              subscription.plan.code
              ? "تمت ترقية VIP"
              : "تم تجديد VIP",

          body:
            renewalSource &&
            renewalSource.plan.code !==
              subscription.plan.code
              ? `تمت ترقية VIP إلى ${subscription.plan.nameAr} مع الحفاظ على المدة المتبقية.`
              : `تم تجديد ${subscription.plan.nameAr} بنجاح.`,

          metadata: {
            planCode:
              subscription.plan.code,

            paymentId:
              input.paymentId,

            expiresAt:
              expiresAt?.toISOString() ??
              null,
          },
        },
      });

      return {
        reused: false,
        subscription:
          updated,
      };
    },
  );
}

/**
 * Cancels renewal/active status without deleting history.
 *
 * The paid subscription record is preserved.
 */
export async function cancelVipSubscription(
  input: CancelVipInput,
) {
  validateSubscriptionId(
    input.subscriptionId,
  );

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
          },
        });

      if (!subscription) {
        throw new Error(
          "VIP_SUBSCRIPTION_NOT_FOUND",
        );
      }

      if (
        subscription.status !==
        VipSubscriptionStatus.ACTIVE
      ) {
        return subscription;
      }

      const updated =
        await tx.vipSubscription.update({
          where: {
            id:
              subscription.id,
          },
          data: {
            status:
              VipSubscriptionStatus.CANCELED,
          },
          include: {
            plan: true,
          },
        });

      await createSubscriptionEvent(
        tx,
        {
          subscriptionId:
            subscription.id,

          type:
            VipSubscriptionEventType.CANCELED,

          metadata: {
            reason:
              input.reason ??
              "USER_REQUEST",

            ...(input.metadata &&
            typeof input.metadata ===
              "object"
              ? input.metadata
              : {}),
          },
        },
      );

      return updated;
    },
  );
}

/**
 * Marks a subscription expired.
 *
 * Access checks already verify expiresAt, so a user loses VIP the moment the
 * date passes whether or not this runs. This only keeps the stored status,
 * the event history and the notification in step with reality.
 *
 * The status change is a single conditional UPDATE, so two workers (or a
 * worker and a lazy caller) racing on the same subscription expire it once and
 * send one notification.
 */
export async function expireVipSubscription(
  subscriptionId: string,
) {
  validateSubscriptionId(
    subscriptionId,
  );

  const now = new Date();

  return runSerializable(
    async (tx) => {
      const subscription =
        await tx.vipSubscription.findUnique({
          where: {
            id:
              subscriptionId,
          },
          include: {
            plan: true,
          },
        });

      if (!subscription) {
        throw new Error(
          "VIP_SUBSCRIPTION_NOT_FOUND",
        );
      }

      const claimed =
        await tx.vipSubscription.updateMany({
          where: {
            id:
              subscription.id,
            status:
              VipSubscriptionStatus.ACTIVE,
            expiresAt: {
              not: null,
              lte: now,
            },
          },
          data: {
            status:
              VipSubscriptionStatus.EXPIRED,
          },
        });

      if (claimed.count !== 1) {
        return {
          changed: false,
          subscription,
        };
      }

      await createSubscriptionEvent(
        tx,
        {
          subscriptionId:
            subscription.id,

          type:
            VipSubscriptionEventType.EXPIRED,

          metadata: {
            expiredAt:
              now.toISOString(),
          },
        },
      );

      await tx.notification.create({
        data: {
          userId:
            subscription.userId,

          type:
            "VIP_EXPIRED",

          title:
            "انتهت عضوية VIP",

          body:
            `انتهت عضوية ${subscription.plan.nameAr}.`,

          metadata: {
            planCode:
              subscription.plan.code,

            subscriptionId:
              subscription.id,

            expiredAt:
              now.toISOString(),
          },
        },
      });

      return {
        changed: true,
        subscription: {
          ...subscription,
          status:
            VipSubscriptionStatus.EXPIRED,
        },
      };
    },
  );
}

/**
 * Expires every subscription whose end date has passed. Meant to be run by a
 * scheduled job; safe to run repeatedly and from several workers at once.
 */
export async function expireDueVipSubscriptions(
  limit = 200,
) {
  const safeLimit =
    Number.isInteger(limit) &&
    limit > 0 &&
    limit <= 1000
      ? limit
      : 200;

  const due =
    await db.vipSubscription.findMany({
      where: {
        status:
          VipSubscriptionStatus.ACTIVE,
        expiresAt: {
          not: null,
          lte: new Date(),
        },
      },
      select: {
        id: true,
      },
      orderBy: {
        expiresAt:
          "asc",
      },
      take: safeLimit,
    });

  let expired = 0;
  let failed = 0;

  for (const { id } of due) {
    try {
      const result =
        await expireVipSubscription(id);
      if (result.changed) expired += 1;
    } catch {
      failed += 1;
    }
  }

  return {
    scanned: due.length,
    expired,
    failed,
  };
}

/**
 * Returns a server-side subscription snapshot.
 *
 * This is intended for dashboard/API responses.
 */
export async function getVipSubscriptionStatus(
  userId: string,
) {
  validateId(
    userId,
    "USER_ID",
  );

  const user =
    await db.user.findUnique({
      where: {
        id:
          userId,
      },
      select: {
        id: true,
        role: true,
        points: true,
      },
    });

  if (!user) {
    throw new Error(
      "USER_NOT_FOUND",
    );
  }

  /*
   * Owner VIP is derived from SUPER_ADMIN.
   */
  if (user.role === "SUPER_ADMIN") {
    return {
      isOwner: true,
      isVip: true,
      status: "OWNER" as const,
      planCode: "OWNER" as const,
      subscriptionId: null,
      startedAt: null,
      expiresAt: null,
      points: user.points,
      pointsMultiplier: 1,
    };
  }

  const now = new Date();

  /*
   * Prefer the subscription that currently grants access. A plain
   * "ORDER BY expiresAt DESC" is wrong here: PostgreSQL sorts NULLs first on
   * DESC, so a PENDING checkout (expiresAt = NULL) would hide the real,
   * active subscription and a paying VIP would be shown as Free.
   */
  const current =
    await db.vipSubscription.findFirst({
      where: {
        userId,
        status:
          VipSubscriptionStatus.ACTIVE,
        OR: [
          {
            expiresAt: null,
          },
          {
            expiresAt: {
              gt: now,
            },
          },
        ],
      },
      include: {
        plan: true,
      },
      orderBy: {
        expiresAt:
          "desc",
      },
    });

  const subscription =
    current ??
    (await db.vipSubscription.findFirst({
      where: {
        userId,
        // A checkout that was never paid says nothing about VIP.
        status: {
          in: [
            VipSubscriptionStatus.ACTIVE,
            VipSubscriptionStatus.EXPIRED,
            VipSubscriptionStatus.CANCELED,
            VipSubscriptionStatus.REFUNDED,
          ],
        },
        startedAt: {
          not: null,
        },
      },
      include: {
        plan: true,
      },
      orderBy: [
        {
          startedAt:
            "desc",
        },
        {
          createdAt:
            "desc",
        },
      ],
    }));

  if (!subscription) {
    return {
      isOwner: false,
      isVip: false,
      status: "NONE" as const,
      planCode: "FREE" as const,
      subscriptionId: null,
      startedAt: null,
      expiresAt: null,
      points: user.points,
      pointsMultiplier: 1,
    };
  }

  const active =
    current !== null;

  /*
   * If the subscription has passed its expiration,
   * the user is immediately treated as Free.
   *
   * The database status can be changed by the
   * expiration worker later, but access never
   * depends on that worker.
   */
  if (!active) {
    const ranOut =
      subscription.status ===
        VipSubscriptionStatus.EXPIRED ||
      (subscription.status ===
        VipSubscriptionStatus.ACTIVE &&
        subscription.expiresAt !== null &&
        subscription.expiresAt <= now);

    return {
      isOwner: false,
      isVip: false,
      status:
        ranOut
          ? ("EXPIRED" as const)
          : ("NONE" as const),
      planCode: "FREE" as const,
      subscriptionId:
        subscription.id,
      startedAt:
        subscription.startedAt,
      expiresAt:
        subscription.expiresAt,
      points: user.points,
      pointsMultiplier: 1,
    };
  }

  const multiplier =
    Number(
      subscription.plan
        .pointsMultiplier,
    );

  return {
    isOwner: false,
    isVip: true,
    status: "ACTIVE" as const,
    planCode:
      subscription.plan.code,
    subscriptionId:
      subscription.id,
    startedAt:
      subscription.startedAt,
    expiresAt:
      subscription.expiresAt,
    points: user.points,
    pointsMultiplier:
      Number.isFinite(
        multiplier,
      ) &&
      multiplier >= 1
        ? multiplier
        : 1,
  };
}
