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

import {
  guardMutation,
  guardRead,
} from "@/lib/api";

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
        chatCredits: true,
        imageCredits: true,
        videoCredits: true,
        planId: true,
      },
    });

  return NextResponse.json({
    success: true,
    data: rewards,
  });
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

          if (
            reward.planId
          ) {
            const subscription =
              await tx.vipSubscription.findFirst({
                where: {
                  userId:
                    user.id,
                  status:
                    VipSubscriptionStatus.ACTIVE,
                  planId:
                    reward.planId,
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
                "VIP_REWARD_PLAN_REQUIRED",
              );
            }
          }

          const activeSubscription =
            await tx.vipSubscription.findFirst({
              where: {
                userId:
                  user.id,
                status:
                  VipSubscriptionStatus.ACTIVE,
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

          if (
            !activeSubscription &&
            (
              reward.chatCredits > 0 ||
              reward.imageCredits > 0 ||
              reward.videoCredits > 0
            )
          ) {
            throw new Error(
              "VIP_REWARD_REQUIRES_ACTIVE_VIP",
            );
          }

          await tx.user.update({
            where: {
              id:
                user.id,
            },
            data: {
              points: {
                increment:
                  reward.points,
              },
            },
          });

          if (
            activeSubscription
          ) {
            await tx.vipSubscription.update({
              where: {
                id:
                  activeSubscription.id,
              },
              data: {
                chatCredits: {
                  increment:
                    reward.chatCredits,
                },
                imageCredits: {
                  increment:
                    reward.imageCredits,
                },
                videoCredits: {
                  increment:
                    reward.videoCredits,
                },
              },
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
                  activeSubscription?.id,
                points:
                  reward.points,
                chatCredits:
                  reward.chatCredits,
                imageCredits:
                  reward.imageCredits,
                videoCredits:
                  reward.videoCredits,
                idempotencyKey:
                  input.idempotencyKey,
                metadata: {
                  source:
                    "vip:rewards",
                },
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
                chatCredits:
                  reward.chatCredits,
                imageCredits:
                  reward.imageCredits,
                videoCredits:
                  reward.videoCredits,
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

    const message =
      error instanceof Error
        ? error.message
        : "VIP_REWARD_CLAIM_FAILED";

    const status =
      message ===
        "UNAUTHORIZED"
        ? 401
        : message ===
            "VIP_REWARD_NOT_FOUND"
          ? 404
          : message ===
              "VIP_REWARD_PLAN_REQUIRED" ||
            message ===
              "VIP_REWARD_REQUIRES_ACTIVE_VIP"
            ? 403
            : 400;

    return NextResponse.json(
      {
        error:
          message,
      },
      {
        status,
      },
    );
  }
}
