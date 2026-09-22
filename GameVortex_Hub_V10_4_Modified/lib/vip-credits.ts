import {
  AiUsageType,
  Prisma,
} from "@prisma/client";

import { db } from "@/lib/prisma";
import { getVipAccess } from "@/lib/vip";

const FREE_AI_MONTHLY_LIMITS: Record<
  AiCreditKind,
  number
> = {
  CHAT: 100,
  IMAGE: 10,
  VIDEO: 2,
};

function getMonthStart(date: Date): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      1,
    ),
  );
}

export type AiCreditKind =
  | "CHAT"
  | "IMAGE"
  | "VIDEO";

type ConsumeAiCreditsInput = {
  userId: string;
  kind: AiCreditKind;
  amount?: number;
  idempotencyKey: string;
  metadata?: Prisma.InputJsonValue;
};

function toUsageType(
  kind: AiCreditKind,
): AiUsageType {
  switch (kind) {
    case "CHAT":
      return AiUsageType.CHAT;

    case "IMAGE":
      return AiUsageType.IMAGE;

    case "VIDEO":
      return AiUsageType.VIDEO;

    default: {
      const exhaustiveCheck: never =
        kind;

      throw new Error(
        `Unsupported AI credit kind: ${String(
          exhaustiveCheck,
        )}`,
      );
    }
  }
}

function getCreditField(
  kind: AiCreditKind,
):
  | "chatCredits"
  | "imageCredits"
  | "videoCredits" {
  switch (kind) {
    case "CHAT":
      return "chatCredits";

    case "IMAGE":
      return "imageCredits";

    case "VIDEO":
      return "videoCredits";

    default: {
      const exhaustiveCheck: never =
        kind;

      throw new Error(
        `Unsupported AI credit kind: ${String(
          exhaustiveCheck,
        )}`,
      );
    }
  }
}

function validateAmount(
  amount: number,
): void {
  if (
    !Number.isSafeInteger(amount) ||
    amount <= 0
  ) {
    throw new Error(
      "INVALID_AI_CREDIT_AMOUNT",
    );
  }
}

function validateIdempotencyKey(
  key: string,
): void {
  if (
    !key ||
    typeof key !== "string" ||
    key.length > 255
  ) {
    throw new Error(
      "INVALID_AI_IDEMPOTENCY_KEY",
    );
  }
}

function buildAiUsageData(
  input: ConsumeAiCreditsInput,
  subscriptionId?: string,
) {
  return {
    userId:
      input.userId,

    ...(subscriptionId
      ? {
          subscriptionId,
        }
      : {}),

    type:
      toUsageType(
        input.kind,
      ),

    amount:
      input.amount ?? 1,

    idempotencyKey:
      input.idempotencyKey,

    ...(input.metadata !==
    undefined
      ? {
          metadata:
            input.metadata,
        }
      : {}),
  };
}

/**
 * Consume AI credits on the server.
 *
 * Rules:
 * - VIP status is checked server-side.
 * - Subscription expiration is checked server-side.
 * - Credits are decremented atomically.
 * - Duplicate requests are protected with idempotencyKey.
 * - Owner accounts receive expanded product-level AI access.
 */
export async function consumeAiCredits(
  input: ConsumeAiCreditsInput,
) {
  const amount =
    input.amount ?? 1;

  validateAmount(amount);

  validateIdempotencyKey(
    input.idempotencyKey,
  );

  /*
   * Fast idempotency check.
   */
  const existing =
    await db.aiUsage.findUnique({
      where: {
        idempotencyKey:
          input.idempotencyKey,
      },
    });

  if (existing) {
    return {
      reused: true,
      usage: existing,
      remaining: null,
    };
  }

  /*
   * Server-side VIP verification.
   */
  const access =
    await getVipAccess(
      input.userId,
    );

  /*
   * OWNER
   *
   * SUPER_ADMIN receives permanent
   * Owner VIP and is not depleted.
   *
   * Usage is still recorded.
   */
  if (access.isOwner) {
    const usage =
      await db.aiUsage.create({
        data:
          buildAiUsageData(
            input,
          ),
      });

    return {
      reused: false,
      usage,
      remaining:
        Number.MAX_SAFE_INTEGER,
    };
  }

  /*
   * FREE users receive the documented free
   * monthly AI allowance. Their usage is stored
   * in AiUsage without a subscriptionId.
   */
  if (!access.isVip) {
    const monthlyLimit =
      FREE_AI_MONTHLY_LIMITS[
        input.kind
      ];

    const monthStart =
      getMonthStart(
        new Date(),
      );

    return db.$transaction(
      async (tx) => {
        const used =
          await tx.aiUsage.aggregate({
            where: {
              userId:
                input.userId,

              subscriptionId:
                null,

              type:
                toUsageType(
                  input.kind,
                ),

              createdAt: {
                gte:
                  monthStart,
              },
            },

            _sum: {
              amount: true,
            },
          });

        const usedAmount =
          used._sum.amount ?? 0;

        if (
          usedAmount + amount >
          monthlyLimit
        ) {
          throw new Error(
            "AI_CREDITS_EXHAUSTED",
          );
        }

        const usage =
          await tx.aiUsage.create({
            data:
              buildAiUsageData(
                input,
              ),
          });

        return {
          reused: false,
          usage,
          remaining:
            monthlyLimit -
            usedAmount -
            amount,
        };
      },
      {
        isolationLevel:
          Prisma.TransactionIsolationLevel
            .Serializable,
      },
    );
  }

  /*
   * Normal VIP user.
   */
  const subscriptionId =
    access.subscriptionId;

  if (
    !subscriptionId
  ) {
    throw new Error(
      "VIP_SUBSCRIPTION_NOT_FOUND",
    );
  }

  const field =
    getCreditField(
      input.kind,
    );

  return db.$transaction(
    async (tx) => {
      /*
       * Second idempotency check inside
       * the transaction.
       *
       * This protects against two identical
       * requests arriving simultaneously.
       */
      const existingInside =
        await tx.aiUsage.findUnique({
          where: {
            idempotencyKey:
              input.idempotencyKey,
          },
        });

      if (existingInside) {
        return {
          reused: true,
          usage:
            existingInside,
          remaining: null,
        };
      }

      /*
       * Only an ACTIVE subscription that
       * has not expired may consume credits.
       */
      const updated =
        await tx.vipSubscription.updateMany({
          where: {
            id:
              subscriptionId,

            status:
              "ACTIVE",

            OR: [
              {
                expiresAt:
                  null,
              },
              {
                expiresAt: {
                  gt: new Date(),
                },
              },
            ],

            [field]: {
              gte: amount,
            },
          } as Prisma.VipSubscriptionWhereInput,

          data: {
            [field]: {
              decrement:
                amount,
            },
          } as Prisma.VipSubscriptionUpdateManyMutationInput,
        });

      /*
       * count !== 1 means:
       *
       * - subscription does not exist
       * - subscription expired
       * - subscription is not active
       * - insufficient AI credits
       */
      if (
        updated.count !== 1
      ) {
        throw new Error(
          "AI_CREDITS_EXHAUSTED",
        );
      }

      /*
       * Record the usage only after
       * the atomic decrement succeeds.
       *
       * IMPORTANT:
       * subscriptionId is guaranteed to be
       * a real string here, never null.
       */
      const usage =
        await tx.aiUsage.create({
          data:
            buildAiUsageData(
              input,
              subscriptionId,
            ),
        });

      /*
       * Read remaining credits.
       */
      const current =
        await tx.vipSubscription.findUnique({
          where: {
            id:
              subscriptionId,
          },

          select: {
            chatCredits:
              true,

            imageCredits:
              true,

            videoCredits:
              true,
          },
        });

      if (!current) {
        throw new Error(
          "VIP_SUBSCRIPTION_NOT_FOUND",
        );
      }

      let remaining: number;

      switch (
        input.kind
      ) {
        case "CHAT":
          remaining =
            current.chatCredits;
          break;

        case "IMAGE":
          remaining =
            current.imageCredits;
          break;

        case "VIDEO":
          remaining =
            current.videoCredits;
          break;

        default: {
          const exhaustiveCheck: never =
            input.kind;

          throw new Error(
            `Unsupported AI credit kind: ${String(
              exhaustiveCheck,
            )}`,
          );
        }
      }

      return {
        reused: false,
        usage,
        remaining,
      };
    },
    {
      isolationLevel:
        Prisma.TransactionIsolationLevel
          .Serializable,
    },
  );
}

/**
 * Consume one or more chat credits.
 */
export async function consumeChatCredits(
  input: Omit<
    ConsumeAiCreditsInput,
    "kind"
  >,
) {
  return consumeAiCredits({
    ...input,
    kind: "CHAT",
  });
}

/**
 * Consume one or more image credits.
 */
export async function consumeImageCredits(
  input: Omit<
    ConsumeAiCreditsInput,
    "kind"
  >,
) {
  return consumeAiCredits({
    ...input,
    kind: "IMAGE",
  });
}

/**
 * Consume one or more video credits.
 */
export async function consumeVideoCredits(
  input: Omit<
    ConsumeAiCreditsInput,
    "kind"
  >,
) {
  return consumeAiCredits({
    ...input,
    kind: "VIDEO",
  });
}


/**
 * Releases a previously consumed AI credit when the
 * downstream AI provider fails after reservation.
 *
 * This is server-only and idempotent.
 */
export async function releaseAiCredits(
  idempotencyKey: string,
) {
  validateIdempotencyKey(
    idempotencyKey,
  );

  return db.$transaction(
    async (tx) => {
      const usage =
        await tx.aiUsage.findUnique({
          where: {
            idempotencyKey,
          },
        });

      if (!usage) {
        return {
          released: false,
          reason: "USAGE_NOT_FOUND",
        } as const;
      }

      if (usage.subscriptionId) {
        const field =
          getCreditField(
            usage.type === AiUsageType.CHAT
              ? "CHAT"
              : usage.type === AiUsageType.IMAGE
                ? "IMAGE"
                : "VIDEO",
          );

        await tx.vipSubscription.update({
          where: {
            id:
              usage.subscriptionId,
          },
          data: {
            [field]: {
              increment:
                usage.amount,
            },
          } as Prisma.VipSubscriptionUpdateInput,
        });
      }

      await tx.aiUsage.delete({
        where: {
          id:
            usage.id,
        },
      });

      return {
        released: true,
      } as const;
    },
    {
      isolationLevel:
        Prisma.TransactionIsolationLevel
          .Serializable,
    },
  );
}
