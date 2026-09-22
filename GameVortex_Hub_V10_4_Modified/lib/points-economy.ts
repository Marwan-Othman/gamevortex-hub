import { getVipAccess } from "./vip";

/*
 * GameVortex Points Economy — Master Task Plan Section 3
 * Items 5 (product points), 6 (point value), 7 (withdrawal minimums).
 *
 * All values are env-overridable in production without a redeploy of
 * the logic itself, following the same pattern as lib/owner-points.ts
 * (which remains the source of truth for the OWNER tier's own
 * withdrawal flow via OwnerWallet — this file does not replace it,
 * it only reuses the same conversion rate for consistency and adds
 * the VIP / USER tiers that did not exist before).
 */

export type PointsTier = "OWNER" | "VIP" | "USER";

function positiveIntegerFromEnv(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function positiveNumberFromEnv(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

/*
 * Item 6 — نظام قيمة النقاط
 * Owner: 30 points = $1 (kept identical to lib/owner-points.ts)
 * VIP: 500 points = $1
 * User: 1000 points = $1
 */
export const POINTS_PER_USD: Record<PointsTier, number> = {
  OWNER: positiveIntegerFromEnv(
    process.env.OWNER_POINTS_PER_USD,
    30,
  ),
  VIP: positiveIntegerFromEnv(
    process.env.VIP_POINTS_PER_USD,
    500,
  ),
  USER: positiveIntegerFromEnv(
    process.env.USER_POINTS_PER_USD,
    1000,
  ),
};

/*
 * Item 7 — نظام السحب والمحافظ (الحد الأدنى بالدولار)
 * Owner: $0.50 | VIP: $5 | User: $10
 */
export const MIN_WITHDRAW_USD: Record<PointsTier, number> = {
  OWNER: positiveNumberFromEnv(
    process.env.OWNER_MIN_WITHDRAW_USD,
    0.5,
  ),
  VIP: positiveNumberFromEnv(
    process.env.VIP_MIN_WITHDRAW_USD,
    5,
  ),
  USER: positiveNumberFromEnv(
    process.env.USER_MIN_WITHDRAW_USD,
    10,
  ),
};

/*
 * Item 5 — نظام النقاط للمنتجات (المنتجات المجانية)
 * Free products: 300 points to owner, 10 points to the buyer.
 */
export const FREE_PRODUCT_POINTS = {
  OWNER: positiveIntegerFromEnv(
    process.env.FREE_PRODUCT_OWNER_POINTS,
    300,
  ),
  USER: positiveIntegerFromEnv(
    process.env.FREE_PRODUCT_USER_POINTS,
    10,
  ),
};

/*
 * Item 5 — نظام النقاط للمنتجات (المنتجات المدفوعة)
 * "كلما ارتفع السعر زادت النقاط": points scale linearly with the
 * amount actually paid. Default: 100 points per $1 spent.
 * This does NOT change the existing owner purchase-points reward
 * (getOwnerPurchasePoints in the payments webhook) — it only adds
 * the buyer-side reward, which did not exist before this change.
 */
const BUYER_POINTS_PER_USD_SPENT = positiveIntegerFromEnv(
  process.env.BUYER_POINTS_PER_USD_SPENT,
  100,
);

export function computeBuyerPurchasePoints(
  amountCents: number,
): number {
  if (
    !Number.isSafeInteger(amountCents) ||
    amountCents <= 0
  ) {
    return FREE_PRODUCT_POINTS.USER;
  }

  const usd = amountCents / 100;

  return Math.max(
    1,
    Math.round(usd * BUYER_POINTS_PER_USD_SPENT),
  );
}

/*
 * Determines a user's points tier server-side (never trust a
 * client-supplied role/VIP flag). OWNER is derived from the
 * SUPER_ADMIN role, VIP from an active VipSubscription — both
 * already resolved by lib/vip.ts's getVipAccess().
 */
export async function getUserPointsTier(
  userId: string,
): Promise<PointsTier> {
  const access = await getVipAccess(userId);

  if (access.isOwner) {
    return "OWNER";
  }

  if (access.isVip) {
    return "VIP";
  }

  return "USER";
}

export function pointsToUsd(
  tier: PointsTier,
  points: number,
): number {
  if (!Number.isSafeInteger(points) || points < 0) {
    throw new Error("INVALID_POINTS");
  }

  return Number(
    (points / POINTS_PER_USD[tier]).toFixed(2),
  );
}

export function usdToPoints(
  tier: PointsTier,
  usd: number,
): number {
  if (!Number.isFinite(usd) || usd < 0) {
    throw new Error("INVALID_USD_AMOUNT");
  }

  return Math.ceil(usd * POINTS_PER_USD[tier]);
}

export function getMinWithdrawPoints(
  tier: PointsTier,
): number {
  return usdToPoints(tier, MIN_WITHDRAW_USD[tier]);
}

/*
 * Item 7 + 11 — التحقق من السحب وخصم النقاط.
 * Only for VIP / USER tiers — the Owner keeps using
 * lib/owner-points.ts's validateOwnerWithdrawal via the existing
 * /api/owner/withdraw route.
 */
export function validateUserWithdrawal(
  tier: PointsTier,
  points: number,
): number {
  if (tier === "OWNER") {
    throw new Error(
      "OWNER_MUST_USE_OWNER_WITHDRAW_ENDPOINT",
    );
  }

  const minPoints = getMinWithdrawPoints(tier);

  if (
    !Number.isSafeInteger(points) ||
    points < minPoints
  ) {
    throw new Error("MINIMUM_WITHDRAWAL_NOT_MET");
  }

  const usd = pointsToUsd(tier, points);

  if (usd < MIN_WITHDRAW_USD[tier]) {
    throw new Error("MINIMUM_WITHDRAWAL_NOT_MET");
  }

  return usd;
}
