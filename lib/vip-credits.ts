import {
  AiUsageType,
  Prisma,
} from "@prisma/client";

import { db } from "@/lib/prisma";
import { getVipAccess } from "@/lib/vip";

/* =========================================================
 * GAMEVORTEX AI CREDIT POLICY
 * =========================================================
 *
 * Priority:
 *
 * 1. SUPER_ADMIN
 *    - Unlimited GameVortex AI access.
 *    - Never charged from the owner's wallet.
 *    - Usage is still recorded.
 *
 * 2. FREE USER
 *    - Uses the monthly free allowance first.
 *    - After the allowance is exhausted, paid AI usage
 *      can be charged from the user's GameVortex wallet.
 *
 * 3. VIP USER
 *    - Uses VIP subscription AI credits first.
 *    - After VIP credits are exhausted, paid AI usage
 *      can be charged from the user's GameVortex wallet.
 *
 * IMPORTANT:
 * The wallet charge is only applied to the user.
 * SUPER_ADMIN is always excluded from wallet charging.
 *
 * AI pricing is intentionally read from environment variables.
 * We do NOT hard-code a price because provider costs can change.
 *
 * Required environment variables for paid AI:
 *
 * AI_CHAT_PRICE_CENTS
 * AI_IMAGE_PRICE_CENTS
 * AI_VIDEO_PRICE_CENTS
 *
 * Example:
 *
 * AI_CHAT_PRICE_CENTS="1"
 * AI_IMAGE_PRICE_CENTS="5"
 * AI_VIDEO_PRICE_CENTS="50"
 *
 * These values represent the amount charged to the user's
 * GameVortex wallet per AI unit.
 * ========================================================= */

/* =========================================================
 * FREE MONTHLY LIMITS
 * ======================================================= */

const FREE_AI_MONTHLY_LIMITS: Record<
  AiCreditKind,
  number
> = {
  CHAT: 100,
  IMAGE: 10,
  VIDEO: 2,
};

/* =========================================================
 * TYPES
 * ======================================================= */

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

type AiPricing = {
  CHAT: number;
  IMAGE: number;
  VIDEO: number;
};

/* =========================================================
 * DATE HELPERS
 * ======================================================= */

function getMonthStart(date: Date): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      1,
    ),
  );
}

/* =========================================================
 * AI PRICING
 * ======================================================= */

/**
 * Read a positive integer from environment variables.
 *
 * Returning null instead of inventing a fallback price is
 * intentional. We never want the application to silently
 * charge users an arbitrary amount.
 */
function readPositiveCents(
  name: string,
): number | null {
  const raw = process.env[name]?.trim();

  if (!raw) {
    return null;
  }

  const value = Number(raw);

  if (
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    return null;
  }

  return value;
}

/**
 * Returns the configured price per AI unit.
 *
 * null means paid AI billing is not configured for that
 * particular operation.
 */
function getAiPricing(): AiPricing {
  return {
    CHAT:
      readPositiveCents(
        "AI_CHAT_PRICE_CENTS",
      ) ?? 0,

    IMAGE:
      readPositiveCents(
        "AI_IMAGE_PRICE_CENTS",
      ) ?? 0,

    VIDEO:
      readPositiveCents(
        "AI_VIDEO_PRICE_CENTS",
      ) ?? 0,
  };
}

function getPricePerUnit(
  kind: AiCreditKind,
): number {
  const pricing =
    getAiPricing();

  return pricing[kind];
}

/* =========================================================
 * PRISMA HELPERS
 * ======================================================= */

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

/* =========================================================
 * VALIDATION
 * ======================================================= */

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

/* =========================================================
 * USAGE METADATA
 * ======================================================= */

function buildAiUsageData(
  input: ConsumeAiCreditsInput,
  subscriptionId?: string,
  walletChargeCents?: number,
) {
  const metadata =
    input.metadata !== undefined
      ? input.metadata
      : undefined;

  const walletMetadata =
    walletChargeCents &&
    walletChargeCents > 0
      ? {
          aiBilling: {
            source:
              "USER_WALLET",

            amountCents:
              walletChargeCents,
          },
        }
      : undefined;

  let finalMetadata:
    | Prisma.InputJsonValue
    | undefined;

  if (
    metadata !== undefined &&
    walletMetadata !== undefined
  ) {
    finalMetadata = {
      ...(metadata as Record<
        string,
        unknown
      >),

      ...walletMetadata,
    } as Prisma.InputJsonValue;
  } else if (
    metadata !== undefined
  ) {
    finalMetadata =
      metadata;
  } else if (
    walletMetadata !== undefined
  ) {
    finalMetadata =
      walletMetadata as Prisma.InputJsonValue;
  }

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

    ...(finalMetadata !==
    undefined
      ? {
          metadata:
            finalMetadata,
        }
      : {}),
  };
}

/* =========================================================
 * WALLET HELPERS
 * ======================================================= */

/**
 * Charge a user's GameVortex wallet.
 *
 * This function is intentionally transaction-scoped.
 * The caller must execute it inside the same Prisma
 * transaction that creates the AiUsage record.
 *
 * SUPER_ADMIN is never sent here.
 */
async function chargeUserWallet(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    amountCents: number;
    kind: AiCreditKind;
    idempotencyKey: string;
  },
) {
  if (
    input.amountCents <= 0
  ) {
    return null;
  }

  const amount =
    new Prisma.Decimal(
      input.amountCents,
    ).div(100);

  const wallet =
    await tx.wallet.findUnique({
      where: {
        userId:
          input.userId,
      },
    });

  if (!wallet) {
    throw new Error(
      "AI_WALLET_NOT_FOUND",
    );
  }

  if (
    wallet.balance.lt(amount)
  ) {
    throw new Error(
      "AI_WALLET_BALANCE_EXHAUSTED",
    );
  }

  const before =
    wallet.balance;

  const after =
    before.sub(amount);

  await tx.wallet.update({
    where: {
      id:
        wallet.id,
    },

    data: {
      balance:
        after,
    },
  });

  const transaction =
    await tx.walletTransaction.create({
      data: {
        userId:
          input.userId,

        walletId:
          wallet.id,

        type:
          "PURCHASE",

        amount:
          amount.neg(),

        balanceBefore:
          before,

        balanceAfter:
          after,

        currency:
          "USD",

        referenceType:
          "AI_USAGE",

        referenceId:
          input.idempotencyKey,

        idempotencyKey:
          `ai-wallet:${input.idempotencyKey}`,

        metadata: {
          aiKind:
            input.kind,

          amountCents:
            input.amountCents,

          direction:
            "DEBIT",
        },
      },
    });

  return {
    transactionId:
      transaction.id,

    amountCents:
      input.amountCents,

    balanceAfter:
      after,
  };
}

/* =========================================================
 * MAIN AI CREDIT CONSUMPTION
 * ======================================================= */

/**
 * Consume AI credits on the server.
 *
 * Priority:
 *
 * SUPER_ADMIN
 *     ↓
 * Unlimited, no wallet charge
 *
 * FREE
 *     ↓
 * Monthly free credits
 *     ↓
 * Wallet billing after free credits are exhausted
 *
 * VIP
 *     ↓
 * VIP credits
 *     ↓
 * Wallet billing after VIP credits are exhausted
 *
 * Provider API calls remain server-side.
 */
export async function consumeAiCredits(
  input: ConsumeAiCreditsInput,
) {
  const amount =
    input.amount ?? 1;

  validateAmount(
    amount,
  );

  validateIdempotencyKey(
    input.idempotencyKey,
  );

  /*
   * First idempotency check.
   *
   * This prevents duplicate charges when the same request
   * is retried by the client.
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
      walletChargedCents:
        getWalletChargeFromUsage(
          existing,
        ),
    };
  }

  /*
   * Server-side VIP verification.
   */
  const access =
    await getVipAccess(
      input.userId,
    );

  /* =======================================================
   * OWNER
   * ===================================================== */

  /**
   * SUPER_ADMIN is the GameVortex owner.
   *
   * Owner access is unlimited inside GameVortex.
   *
   * Most importantly:
   *
   * NO OWNER WALLET CHARGE.
   *
   * This is the exact branch that prevents the owner from
   * paying for AI usage through the GameVortex wallet.
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

      walletChargedCents:
        0,
    };
  }

  /* =======================================================
   * FREE USER
   * ===================================================== */

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
        /*
         * Re-check idempotency inside the transaction.
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

            walletChargedCents:
              getWalletChargeFromUsage(
                existingInside,
              ),
          };
        }

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

        /*
         * Free credits still have priority.
         */
        if (
          usedAmount + amount <=
          monthlyLimit
        ) {
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

            walletChargedCents:
              0,
          };
        }

        /*
         * Free allowance is exhausted.
         *
         * Calculate how many units must be paid.
         */
        const freeRemaining =
          Math.max(
            0,
            monthlyLimit -
              usedAmount,
          );

        const paidAmount =
          Math.max(
            0,
            amount -
              freeRemaining,
          );

        const pricePerUnit =
          getPricePerUnit(
            input.kind,
          );

        if (
          paidAmount > 0 &&
          pricePerUnit <= 0
        ) {
          throw new Error(
            "AI_BILLING_NOT_CONFIGURED",
          );
        }

        const chargeCents =
          paidAmount *
          pricePerUnit;

        const wallet =
          await chargeUserWallet(
            tx,
            {
              userId:
                input.userId,

              amountCents:
                chargeCents,

              kind:
                input.kind,

              idempotencyKey:
                input.idempotencyKey,
            },
          );

        const usage =
          await tx.aiUsage.create({
            data:
              buildAiUsageData(
                input,
                undefined,
                chargeCents,
              ),
          });

        return {
          reused: false,
          usage,

          remaining:
            0,

          walletChargedCents:
            wallet
              ?.amountCents ??
            0,
        };
      },
      {
        isolationLevel:
          Prisma.TransactionIsolationLevel
            .Serializable,
      },
    );
  }

  /* =======================================================
   * VIP USER
   * ===================================================== */

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
       * Second idempotency check inside the transaction.
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

          walletChargedCents:
            getWalletChargeFromUsage(
              existingInside,
            ),
        };
      }

      /*
       * Try to consume VIP credits first.
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
                  gt:
                    new Date(),
                },
              },
            ],

            [field]: {
              gte:
                amount,
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
       * VIP credits are available.
       */
      if (
        updated.count === 1
      ) {
        const usage =
          await tx.aiUsage.create({
            data:
              buildAiUsageData(
                input,
                subscriptionId,
              ),
          });

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

          walletChargedCents:
            0,
        };
      }

      /*
       * VIP credits are exhausted.
       *
       * The user can continue using GameVortex AI by paying
       * from their own wallet.
       */
      const pricePerUnit =
        getPricePerUnit(
          input.kind,
        );

      if (
        pricePerUnit <= 0
      ) {
        throw new Error(
          "AI_BILLING_NOT_CONFIGURED",
        );
      }

      const chargeCents =
        amount *
        pricePerUnit;

      const wallet =
        await chargeUserWallet(
          tx,
          {
            userId:
              input.userId,

            amountCents:
              chargeCents,

            kind:
              input.kind,

            idempotencyKey:
              input.idempotencyKey,
          },
        );

      const usage =
        await tx.aiUsage.create({
          data:
            buildAiUsageData(
              input,
              undefined,
              chargeCents,
            ),
        });

      return {
        reused: false,
        usage,

        remaining:
          0,

        walletChargedCents:
          wallet
            ?.amountCents ??
          0,
      };
    },
    {
      isolationLevel:
        Prisma.TransactionIsolationLevel
          .Serializable,
    },
  );
}

/* =========================================================
 * PUBLIC HELPERS
 * ======================================================= */

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
    kind:
      "CHAT",
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
    kind:
      "IMAGE",
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
    kind:
      "VIDEO",
  });
}

/* =========================================================
 * USAGE METADATA HELPERS
 * ======================================================= */

/**
 * Reads the wallet charge from AiUsage metadata.
 *
 * This is needed when an AI provider fails after the wallet
 * was charged, so releaseAiCredits() can refund the user.
 */
function getWalletChargeFromUsage(
  usage: {
    metadata: Prisma.JsonValue | null;
  },
): number {
  const metadata =
    usage.metadata;

  if (
    !metadata ||
    typeof metadata !==
      "object" ||
    Array.isArray(metadata)
  ) {
    return 0;
  }

  const aiBilling =
    (
      metadata as Record<
        string,
        unknown
      >
    ).aiBilling;

  if (
    !aiBilling ||
    typeof aiBilling !==
      "object" ||
    Array.isArray(aiBilling)
  ) {
    return 0;
  }

  const amountCents =
    (
      aiBilling as Record<
        string,
        unknown
      >
    ).amountCents;

  if (
    typeof amountCents !==
      "number" ||
    !Number.isSafeInteger(
      amountCents,
    ) ||
    amountCents <= 0
  ) {
    return 0;
  }

  return amountCents;
}

/* =========================================================
 * RELEASE / REFUND AI USAGE
 * ======================================================= */

/**
 * Releases a previously consumed AI credit when the
 * downstream AI provider fails after reservation.
 *
 * This function now handles both:
 *
 * 1. VIP credits
 *    → returned to the VIP subscription.
 *
 * 2. User wallet charges
 *    → refunded to the same user's wallet.
 *
 * The operation is transactional and idempotent.
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
          reason:
            "USAGE_NOT_FOUND",
        } as const;
      }

      /* =====================================================
       * RETURN VIP CREDITS
       * =================================================== */

      if (
        usage.subscriptionId
      ) {
        const field =
          getCreditField(
            usage.type ===
              AiUsageType.CHAT
              ? "CHAT"
              : usage.type ===
                  AiUsageType.IMAGE
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

      /* =====================================================
       * REFUND USER WALLET
       * =================================================== */

      const walletChargeCents =
        getWalletChargeFromUsage(
          usage,
        );

      if (
        walletChargeCents > 0
      ) {
        const wallet =
          await tx.wallet.findUnique({
            where: {
              userId:
                usage.userId,
            },
          });

        if (!wallet) {
          throw new Error(
            "AI_REFUND_WALLET_NOT_FOUND",
          );
        }

        const refundAmount =
          new Prisma.Decimal(
            walletChargeCents,
          ).div(100);

        const before =
          wallet.balance;

        const after =
          before.add(
            refundAmount,
          );

        await tx.wallet.update({
          where: {
            id:
              wallet.id,
          },

          data: {
            balance:
              after,
          },
        });

        await tx.walletTransaction.create({
          data: {
            userId:
              usage.userId,

            walletId:
              wallet.id,

            type:
              "REFUND",

            amount:
              refundAmount,

            balanceBefore:
              before,

            balanceAfter:
              after,

            currency:
              "USD",

            referenceType:
              "AI_USAGE_REFUND",

            referenceId:
              usage.id,

            idempotencyKey:
              `ai-wallet-refund:${usage.id}`,

            metadata: {
              aiUsageId:
                usage.id,

              amountCents:
                walletChargeCents,

              reason:
                "AI_PROVIDER_FAILURE",
            },
          },
        });
      }

      /* =====================================================
       * DELETE RESERVED USAGE
       * =================================================== */

      await tx.aiUsage.delete({
        where: {
          id:
            usage.id,
        },
      });

      return {
        released: true,

        walletRefundedCents:
          walletChargeCents,
      } as const;
    },
    {
      isolationLevel:
        Prisma.TransactionIsolationLevel
          .Serializable,
    },
  );
}
