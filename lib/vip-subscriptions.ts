import {
  Prisma,
  VipSubscriptionEventType,
  VipSubscriptionStatus,
  PaymentStatus,
} from "@prisma/client";

import { db } from "@/lib/prisma";
import {
  addMonthsUtc,
  getVipPlan,
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
  metadata?: Prisma.InputJsonValue;
};

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
            "planCode",
          ],
          equals:
            plan.code,
        },
      },
      orderBy: {
        createdAt: "desc",
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
        expiration:
          expirationText,
      },
    },
  });
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
       * Server-side price verification.
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
        input.currency &&
        input.currency.toUpperCase() !==
          subscription.plan.currency.toUpperCase()
      ) {
        throw new Error(
          "VIP_PAYMENT_CURRENCY_MISMATCH",
        );
      }

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

            chatCredits:
              subscription.plan
                .chatCredits,

            imageCredits:
              subscription.plan
                .imageCredits,

            videoCredits:
              subscription.plan
                .videoCredits,

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
    {
      isolationLevel:
        Prisma.TransactionIsolationLevel.Serializable,
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
            user: {
              select: {
                id: true,
                role: true,
              },
            },
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

      if (
        input.amountCents !==
        subscription.plan.priceCents
      ) {
        throw new Error(
          "VIP_PAYMENT_AMOUNT_MISMATCH",
        );
      }

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

      const baseDate =
        subscription.expiresAt &&
        subscription.expiresAt > now
          ? subscription.expiresAt
          : now;

      const expiresAt =
        calculateExpiry(
          baseDate,
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

            startedAt:
              subscription.startedAt ??
              now,

            expiresAt,

            paymentId:
              input.paymentId,

            provider:
              input.provider,

            chatCredits:
              subscription.plan
                .chatCredits,

            imageCredits:
              subscription.plan
                .imageCredits,

            videoCredits:
              subscription.plan
                .videoCredits,

            nextRewardAt:
              expiresAt,
          },
          include: {
            plan: true,
          },
        });

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
              baseDate.toISOString(),
          },
        },
      );

      await createSubscriptionEvent(
        tx,
        {
          subscriptionId:
            subscription.id,

          type:
            VipSubscriptionEventType.RENEWED,

          provider:
            input.provider,

          metadata: {
            planCode:
              subscription.plan.code,

            expiresAt:
              expiresAt?.toISOString() ??
              null,
          },
        },
      );

      await tx.notification.create({
        data: {
          userId:
            subscription.userId,

          type:
            "VIP_RENEWED",

          title:
            "تم تجديد VIP",

          body:
            `تم تجديد ${subscription.plan.nameAr} بنجاح.`,

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
    {
      isolationLevel:
        Prisma.TransactionIsolationLevel.Serializable,
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
 * Access checks already verify expiresAt,
 * so expiration does not depend on a cron job.
 */
export async function expireVipSubscription(
  subscriptionId: string,
) {
  validateSubscriptionId(
    subscriptionId,
  );

  const now = new Date();

  return db.$transaction(
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

      if (
        subscription.status !==
        VipSubscriptionStatus.ACTIVE
      ) {
        return {
          changed: false,
          subscription,
        };
      }

      if (
        !subscription.expiresAt ||
        subscription.expiresAt > now
      ) {
        return {
          changed: false,
          subscription,
        };
      }

      const updated =
        await tx.vipSubscription.update({
          where: {
            id:
              subscription.id,
          },
          data: {
            status:
              VipSubscriptionStatus.EXPIRED,
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

            expiredAt:
              now.toISOString(),
          },
        },
      });

      return {
        changed: true,
        subscription:
          updated,
      };
    },
  );
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
      ...OWNER_AI_ENTITLEMENTS,
    };
  }

  const now = new Date();

  const freeCredits = { chat: 0, image: 0, video: 0 };

  const subscription =
    await db.vipSubscription.findFirst({
      where: {
        userId,
      },
      include: {
        plan: true,
      },
      orderBy: [
        {
          expiresAt:
            "desc",
        },
        {
          createdAt:
            "desc",
        },
      ],
    });

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
      chatCredits:
        freeCredits.chat,
      imageCredits:
        freeCredits.image,
      videoCredits:
        freeCredits.video,
    };
  }

  const active =
    subscription.status ===
      VipSubscriptionStatus.ACTIVE &&
    (
      subscription.expiresAt ===
        null ||
      subscription.expiresAt >
        now
    );

  /*
   * If the subscription has passed its expiration,
   * the user is immediately treated as Free.
   *
   * The database status can be changed by the
   * expiration worker later, but access never
   * depends on that worker.
   */
  if (!active) {
    return {
      isOwner: false,
      isVip: false,
      status:
        subscription.status ===
          VipSubscriptionStatus.EXPIRED
          ? "EXPIRED"
          : "NONE",
      planCode: "FREE" as const,
      subscriptionId:
        subscription.id,
      startedAt:
        subscription.startedAt,
      expiresAt:
        subscription.expiresAt,
      points: user.points,
      pointsMultiplier: 1,
      chatCredits:
        freeCredits.chat,
      imageCredits:
        freeCredits.image,
      videoCredits:
        freeCredits.video,
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
    chatCredits:
      subscription.chatCredits,
    imageCredits:
      subscription.imageCredits,
    videoCredits:
      subscription.videoCredits,
  };
}
