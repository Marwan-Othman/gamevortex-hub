import {
  NextRequest,
  NextResponse,
} from "next/server";

import { z } from "zod";

import { Prisma } from "@prisma/client";

import {
  db,
} from "@/lib/prisma";

import {
  requireOwner,
} from "@/lib/auth";

import {
  guardMutation,
  guardRead,
} from "@/lib/api";

const rewardSchema =
  z.object({
    code:
      z.string()
        .trim()
        .min(2)
        .max(64)
        .regex(
          /^[A-Z0-9_:-]+$/,
        ),

    nameAr:
      z.string()
        .trim()
        .min(1)
        .max(120),

    nameEn:
      z.string()
        .trim()
        .min(1)
        .max(120),

    planId:
      z.string()
        .cuid()
        .nullable()
        .optional(),

    points:
      z.number()
        .int()
        .min(0)
        .max(1_000_000),

    chatCredits:
      z.number()
        .int()
        .min(0)
        .max(1_000_000),

    imageCredits:
      z.number()
        .int()
        .min(0)
        .max(1_000_000),

    videoCredits:
      z.number()
        .int()
        .min(0)
        .max(1_000_000),

    active:
      z.boolean()
        .default(true),

    metadata:
      z.record(
        z.string(),
        z.unknown(),
      )
      .optional(),
  });

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

export async function GET(
  request: NextRequest,
) {
  const blocked =
    await guardRead(
      request,
      "admin:vip-rewards",
      60,
    );

  if (blocked) {
    return blocked;
  }

  try {
    await requireOwner();

    const rewards =
      await db.vipReward.findMany({
        orderBy: {
          createdAt:
            "desc",
        },
        include: {
          plan: {
            select: {
              code: true,
              nameAr: true,
            },
          },
        },
      });

    return NextResponse.json({
      success: true,
      data: rewards,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "ADMIN_VIP_REWARDS_FAILED";

    const status =
      message ===
        "UNAUTHORIZED"
        ? 401
        : message ===
            "FORBIDDEN"
          ? 403
          : 500;

    return NextResponse.json(
      {
        error:
          status === 500
            ? "ADMIN_VIP_REWARDS_FAILED"
            : message,
      },
      {
        status,
      },
    );
  }
}

export async function POST(
  request: NextRequest,
) {
  const blocked =
    await guardMutation(
      request,
      "admin:vip-rewards",
      30,
    );

  if (blocked) {
    return blocked;
  }

  try {
    await requireOwner();

    const input =
      rewardSchema.parse(
        await request.json(),
      );

    if (
      input.planId
    ) {
      const plan =
        await db.vipPlan.findUnique({
          where: {
            id:
              input.planId,
          },
          select: {
            id: true,
          },
        });

      if (!plan) {
        return NextResponse.json(
          {
            error:
              "VIP_PLAN_NOT_FOUND",
          },
          {
            status: 404,
          },
        );
      }
    }

    const reward =
      await db.vipReward.create({
        data: {
          code:
            input.code,
          nameAr:
            input.nameAr,
          nameEn:
            input.nameEn,
          planId:
            input.planId,
          points:
            input.points,
          chatCredits:
            input.chatCredits,
          imageCredits:
            input.imageCredits,
          videoCredits:
            input.videoCredits,
          active:
            input.active,
          metadata:
            input.metadata as Prisma.InputJsonValue | undefined,
        },
      });

    return NextResponse.json(
      {
        success: true,
        data: reward,
      },
      {
        status: 201,
      },
    );
  } catch (error) {
    if (
      error instanceof
      z.ZodError
    ) {
      return NextResponse.json(
        {
          error:
            "INVALID_VIP_REWARD",
        },
        {
          status: 400,
        },
      );
    }

    const message =
      error instanceof Error
        ? error.message
        : "ADMIN_VIP_REWARD_CREATE_FAILED";

    const status =
      message ===
        "UNAUTHORIZED"
        ? 401
        : message ===
            "FORBIDDEN"
          ? 403
          : 400;

    return NextResponse.json(
      {
        error:
          status === 400
            ? message
            : message,
      },
      {
        status,
      },
    );
  }
}
