import { Prisma, VipSubscriptionStatus } from "@prisma/client";
import { db } from "@/lib/prisma";
import { getVipPlan, type VipPlanCode } from "@/lib/vip-plans";
import { OWNER_AI_ENTITLEMENTS, hasOwnerAiAccess } from "@/lib/ai/entitlements";

export type VipAccess = {
  isOwner: boolean;
  isVip: boolean;
  planCode: VipPlanCode | "OWNER" | "FREE";
  subscriptionId: string | null;
  status: "OWNER" | "ACTIVE" | "EXPIRED" | "NONE";
  startedAt: Date | null;
  expiresAt: Date | null;
  pointsMultiplier: number;
  chatCredits: number;
  imageCredits: number;
  videoCredits: number;
};

function decimalToNumber(value: Prisma.Decimal | number): number {
  return typeof value === "number" ? value : Number(value.toString());
}

function safeMultiplier(
  value: Prisma.Decimal | number | null | undefined,
): number {
  const parsed = value == null ? 1 : decimalToNumber(value);

  if (
    !Number.isFinite(parsed) ||
    parsed < 1 ||
    parsed > 100
  ) {
    return 1;
  }

  return parsed;
}

/**
 * Owner VIP is derived from the server-side role.
 * It must never depend on browser data or a client-supplied email flag.
 */
export async function getVipAccess(
  userId: string,
): Promise<VipAccess> {
  if (!userId) {
    throw new Error("USER_ID_REQUIRED");
  }

  const user = await db.user.findUnique({
    where: {
      id: userId,
    },
    select: {
      role: true,
    },
  });

  if (!user) {
    throw new Error("USER_NOT_FOUND");
  }

  /*
   * SUPER_ADMIN automatically receives permanent Owner VIP.
   * No expiresAt is required.
   */
  if (hasOwnerAiAccess(user.role)) {
    return {
      isOwner: true,
      isVip: true,
      planCode: "OWNER",
      subscriptionId: null,
      status: "OWNER",
      startedAt: null,
      expiresAt: null,
      pointsMultiplier: 1,
      ...OWNER_AI_ENTITLEMENTS,
    };
  }

  const now = new Date();

  const subscription =
    await db.vipSubscription.findFirst({
      where: {
        userId,
        status: VipSubscriptionStatus.ACTIVE,
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
        expiresAt: "desc",
      },
    });

  /*
   * No valid active subscription means normal Free access.
   *
   * Notice that this check is performed on the server.
   */
  if (!subscription) {
    return {
      isOwner: false,
      isVip: false,
      planCode: "FREE",
      subscriptionId: null,
      status: "NONE",
      startedAt: null,
      expiresAt: null,
      pointsMultiplier: 1,
      chatCredits: 0,
      imageCredits: 0,
      videoCredits: 0,
    };
  }

  return {
    isOwner: false,
    isVip: true,
    planCode:
      (subscription.plan.code as VipPlanCode) ||
      "FREE",
    subscriptionId: subscription.id,
    status: "ACTIVE",
    startedAt: subscription.startedAt,
    expiresAt: subscription.expiresAt,
    pointsMultiplier: safeMultiplier(
      subscription.plan.pointsMultiplier,
    ),
    chatCredits: subscription.chatCredits,
    imageCredits: subscription.imageCredits,
    videoCredits: subscription.videoCredits,
  };
}

export async function requireActiveVip(
  userId: string,
): Promise<VipAccess> {
  const access = await getVipAccess(userId);

  if (!access.isVip) {
    throw new Error("VIP_REQUIRED");
  }

  return access;
}

export async function getServerVipPlan(
  code: unknown,
) {
  const plan = getVipPlan(code);

  if (!plan) {
    throw new Error("VIP_PLAN_NOT_FOUND");
  }

  return plan;
}

/**
 * Calculates the final points reward on the server.
 * The browser must never provide the multiplier or final amount.
 */
export function applyVipPointsMultiplier(
  basePoints: number,
  multiplier: number,
): number {
  if (
    !Number.isSafeInteger(basePoints) ||
    basePoints <= 0
  ) {
    throw new Error("INVALID_BASE_POINTS");
  }

  if (
    !Number.isFinite(multiplier) ||
    multiplier < 1 ||
    multiplier > 100
  ) {
    throw new Error("INVALID_VIP_MULTIPLIER");
  }

  return Math.floor(
    basePoints * multiplier,
  );
}
