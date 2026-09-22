import {
  NextRequest,
  NextResponse,
} from "next/server";

import { z } from "zod";

import {
  Prisma,
} from "@prisma/client";

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

const updateSchema =
  z.object({
    code:
      z.string()
        .trim()
        .min(1)
        .max(32),

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

    descriptionAr:
      z.string()
        .trim()
        .max(1000)
        .nullable()
        .optional(),

    descriptionEn:
      z.string()
        .trim()
        .max(1000)
        .nullable()
        .optional(),

    priceCents:
      z.number()
        .int()
        .min(0)
        .max(100_000_000),

    durationMonths:
      z.number()
        .int()
        .min(1)
        .max(120)
        .nullable(),

    pointsMultiplier:
      z.number()
        .min(1)
        .max(100),

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
      z.boolean(),

    sortOrder:
      z.number()
        .int()
        .min(-100_000)
        .max(100_000),
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
      "admin:vip-plans",
      60,
    );

  if (blocked) {
    return blocked;
  }

  try {
    await requireOwner();

    const plans =
      await db.vipPlan.findMany({
        orderBy: {
          sortOrder:
            "asc",
        },
      });

    return NextResponse.json({
      success: true,
      data: plans,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "ADMIN_VIP_PLANS_FAILED";

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
            ? "ADMIN_VIP_PLANS_FAILED"
            : message,
      },
      {
        status,
      },
    );
  }
}

export async function PATCH(
  request: NextRequest,
) {
  const blocked =
    await guardMutation(
      request,
      "admin:vip-plans",
      30,
    );

  if (blocked) {
    return blocked;
  }

  try {
    await requireOwner();

    const input =
      updateSchema.parse(
        await request.json(),
      );

    const existing =
      await db.vipPlan.findUnique({
        where: {
          code:
            input.code,
        },
      });

    if (!existing) {
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

    /*
     * FREE and OWNER remain non-purchasable.
     * Owner access is derived from SUPER_ADMIN,
     * not from purchasing the OWNER plan.
     */
    if (
      input.code ===
        "FREE" ||
      input.code ===
        "OWNER"
    ) {
      if (
        input.priceCents !== 0 ||
        input.durationMonths !== null
      ) {
        return NextResponse.json(
          {
            error:
              "SPECIAL_VIP_PLAN_MUST_BE_FREE",
          },
          {
            status: 400,
          },
        );
      }
    } else {
      if (
        input.priceCents <= 0 ||
        input.durationMonths === null
      ) {
        return NextResponse.json(
          {
            error:
              "PAID_VIP_PLAN_REQUIRES_PRICE_AND_DURATION",
          },
          {
            status: 400,
          },
        );
      }
    }

    const updated =
      await db.vipPlan.update({
        where: {
          id:
            existing.id,
        },
        data: {
          nameAr:
            input.nameAr,

          nameEn:
            input.nameEn,

          descriptionAr:
            input.descriptionAr,

          descriptionEn:
            input.descriptionEn,

          priceCents:
            input.priceCents,

          durationMonths:
            input.durationMonths,

          pointsMultiplier:
            new Prisma.Decimal(
              input.pointsMultiplier,
            ),

          chatCredits:
            input.chatCredits,

          imageCredits:
            input.imageCredits,

          videoCredits:
            input.videoCredits,

          active:
            input.active,

          sortOrder:
            input.sortOrder,

          updatedAt:
            new Date(),
        },
      });

    return NextResponse.json({
      success: true,
      data: updated,
    });
  } catch (error) {
    if (
      error instanceof
      z.ZodError
    ) {
      return NextResponse.json(
        {
          error:
            "INVALID_VIP_PLAN",
        },
        {
          status: 400,
        },
      );
    }

    const message =
      error instanceof Error
        ? error.message
        : "ADMIN_VIP_PLAN_UPDATE_FAILED";

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
            ? "ADMIN_VIP_PLAN_UPDATE_FAILED"
            : message,
      },
      {
        status,
      },
    );
  }
}
