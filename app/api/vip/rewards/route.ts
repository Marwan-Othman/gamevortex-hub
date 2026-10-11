import {
  NextRequest,
  NextResponse,
} from "next/server";

import { z } from "zod";

import {
  Prisma,
  VipSubscriptionStatus,
} from "@prisma/client";

import {
  db,
} from "@/lib/prisma";

import {
  requireUser,
} from "@/lib/auth";
import { creditPointsInTransaction } from "@/lib/points";

import { guardMutation, guardRead, publicErrorCode, internalError } from "@/lib/api";

const claimSchema =
  z.object({
    rewardId:
      z.string()
        .cuid(),

    idempotencyKey:
      z.string()
        .trim()
        .min(16)
        .max(255),
  });

export const runtime =
  "nodejs";

export async function GET(
  request: NextRequest,
) {
  const blocked =
    await guardRead(
      request,
      "vip:rewards",
      60,
    );

  if (blocked) {
    return blocked;
  }

  try {
  const rewards =
    await db.vipReward.findMany({
      where: {
        active:
          true,
      },
      orderBy: {
        createdAt:
          "asc",
      },
      select: {
        id: true,
        code: true,
        nameAr: true,
        nameEn: true,
        points: true,
        planId: true,
      },
    });

  return NextResponse.json({
    success: true,
    data: rewards,
  });
  } catch (error) {
    return internalError("vip:rewards:list", error, "VIP_REWARDS_LOAD_FAILED");
  }
}

export async function POST(
  request: NextRequest,
) {
  const blocked =
    await guardMutation(
      request,
      "vip:rewards:claim",
      20,
    );

  if (blocked) {
    return blocked;
  }

  try {
    const user =
      await requireUser();

    const input =
      claimSchema.parse(
        await request.json(),
      );

    const result =
      await db.$transaction(
        async (tx) => {
          const existing =
            await tx.vipRewardClaim.findUnique({
              where: {
                idempotencyKey:
                  input.idempotencyKey,
              },
            });

          if (existing) {
            if (existing.userId !== user.id) throw new Error("IDEMPOTENCY_KEY_CONFLICT");
            return {
              reused: true,
              claim: existing,
            };
          }

          const reward =
            await tx.vipReward.findUnique({
              where: {
                id:
                  input.rewardId,
              },
            });

          if (
            !reward ||
            !reward.active
          ) {
            throw new Error(
              "VIP_REWARD_NOT_FOUND",
            );
          }

          /*
           * A reward is only for someone whose VIP is active right now. A
           * reward tied to a plan needs that plan; an open reward needs any
           * active plan. (Without this check an open reward could be claimed
           * by anybody, any number of times, by sending a new key each time.)
           */
          const subscription =
            await tx.vipSubscription.findFirst({
              where: {
                userId:
                  user.id,
                status:
                  VipSubscriptionStatus.ACTIVE,
                ...(reward.planId
                  ? {
                      planId:
                        reward.planId,
                    }
                  : {}),
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
              },
              orderBy: {
                expiresAt:
                  "desc",
              },
            });

          if (!subscription) {
            throw new Error(
              reward.planId
                ? "VIP_REWARD_PLAN_REQUIRED"
                : "VIP_REWARD_REQUIRES_ACTIVE_VIP",
            );
          }

          /*
           * One claim per reward per subscription period. The row lock makes
           * two parallel requests (with different idempotency keys) take turns,
           * so the second one sees the first one's claim.
           */
          await tx.$queryRaw(
            Prisma.sql`SELECT "id" FROM "VipSubscription" WHERE "id" = ${subscription.id} FOR UPDATE`,
          );

          const alreadyClaimed =
            await tx.vipRewardClaim.findFirst({
              where: {
                userId:
                  user.id,
                rewardId:
                  reward.id,
                subscriptionId:
                  subscription.id,
              },
              select: {
                id: true,
              },
            });

          if (alreadyClaimed) {
            throw new Error(
              "VIP_REWARD_ALREADY_CLAIMED",
            );
          }

          if (reward.points > 0) {
            await creditPointsInTransaction(tx, {
              userId: user.id,
              amount: reward.points,
              reason: "VIP_REWARD_CLAIM",
              sourceId: reward.id,
              idempotencyKey: `vip-reward:${input.idempotencyKey}`,
              metadata: { source: "vip:rewards", claimKey: input.idempotencyKey },
            });
          }

          const claim =
            await tx.vipRewardClaim.create({
              data: {
                userId:
                  user.id,
                rewardId:
                  reward.id,
                subscriptionId:
                  subscription.id,
                points:
                  reward.points,
                idempotencyKey:
                  input.idempotencyKey,
                metadata: {
                  source:
                    "vip:rewards",
                },
              },
            });

          await tx.vipSubscription.update({
            where: {
              id:
                subscription.id,
            },
            data: {
              lastRewardAt:
                new Date(),
            },
          });

          await tx.notification.create({
            data: {
              userId:
                user.id,
              type:
                "VIP_REWARD_CLAIMED",
              title:
                "تم استلام مكافأة VIP",
              body:
                reward.nameAr,
              metadata: {
                rewardId:
                  reward.id,
                points:
                  reward.points,
              },
            },
          });

          return {
            reused: false,
            claim,
          };
        },
        {
          isolationLevel:
            Prisma.TransactionIsolationLevel
              .Serializable,
        },
      );

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    if (
      error instanceof
      z.ZodError
    ) {
      return NextResponse.json(
        {
          error:
            "INVALID_VIP_REWARD_CLAIM",
        },
        {
          status: 400,
        },
      );
    }

    if (
      error instanceof
        Prisma.PrismaClientKnownRequestError &&
      error.code === "P2034"
    ) {
      return NextResponse.json(
        {
          error:
            "VIP_REWARD_CLAIM_CONFLICT_RETRY",
        },
        {
          status: 409,
        },
      );
    }

    const message =
      publicErrorCode(error, "VIP_REWARD_CLAIM_FAILED");

    const known =
      new Set([
        "UNAUTHORIZED",
        "VIP_REWARD_NOT_FOUND",
        "VIP_REWARD_PLAN_REQUIRED",
        "VIP_REWARD_REQUIRES_ACTIVE_VIP",
        "VIP_REWARD_ALREADY_CLAIMED",
        "IDEMPOTENCY_KEY_CONFLICT",
      ]);

    const code =
      known.has(message)
        ? message
        : "VIP_REWARD_CLAIM_FAILED";

    const status =
      code === "UNAUTHORIZED"
        ? 401
        : code === "VIP_REWARD_NOT_FOUND"
          ? 404
          : code === "VIP_REWARD_PLAN_REQUIRED" ||
              code === "VIP_REWARD_REQUIRES_ACTIVE_VIP"
            ? 403
            : code === "VIP_REWARD_ALREADY_CLAIMED" ||
                code === "IDEMPOTENCY_KEY_CONFLICT"
              ? 409
              : 500;

    return NextResponse.json(
      {
        error:
          code,
      },
      {
        status,
      },
    );
  }
}
