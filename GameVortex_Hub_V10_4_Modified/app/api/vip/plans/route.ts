import { NextRequest, NextResponse } from "next/server";
import { guardRead } from "@/lib/api";
import { db } from "@/lib/prisma";
import {
  type VipPlanKind,
} from "@/lib/vip-plans";

export const dynamic = "force-dynamic";

/**
 * GET /api/vip/plans
 * قائمة باقات VIP (عامة، لا تحتاج تسجيل دخول). الأسعار والمدد من الخادم.
 */
export async function GET(request: NextRequest) {
  const blocked = await guardRead(request, "vip:plans", 120);

  if (blocked) {
    return blocked;
  }

  const plans =
    await db.vipPlan.findMany({
      where: {
        active: true,
      },
      orderBy: {
        sortOrder:
          "asc",
      },
    });

  return NextResponse.json({
    success: true,
    data: plans.map(
      (plan) => {
        const kind: VipPlanKind =
          plan.code === "OWNER"
            ? "OWNER"
            : plan.code === "FREE"
              ? "FREE"
              : "PAID";

        const pointsMultiplier =
          Number(
            plan.pointsMultiplier,
          );

        return {
          code:
            plan.code,
          kind,
          emoji:
            plan.code ===
            "VIP_1M"
              ? "👑"
              : plan.code ===
                  "VIP_3M"
                ? "💎"
                : plan.code ===
                    "VIP_6M"
                  ? "🔥"
                  : plan.code ===
                      "VIP_1Y"
                    ? "🏆"
                    : plan.code ===
                        "OWNER"
                      ? "👑"
                      : "🆓",
          nameAr:
            plan.nameAr,
          nameEn:
            plan.nameEn,
          priceCents:
            plan.priceCents,
          priceLabel:
            `$${(
              plan.priceCents /
              100
            ).toFixed(2)}`,
          currency:
            plan.currency,
          durationMonths:
            plan.durationMonths,
          purchasable:
            kind === "PAID" &&
            plan.priceCents >
              0 &&
            plan.durationMonths !==
              null,
          pointsMultiplier:
            Number.isFinite(
              pointsMultiplier,
            )
              ? pointsMultiplier
              : 1,
          chatCredits:
            plan.chatCredits,
          imageCredits:
            plan.imageCredits,
          videoCredits:
            plan.videoCredits,
        };
      },
    ),
  });
}
