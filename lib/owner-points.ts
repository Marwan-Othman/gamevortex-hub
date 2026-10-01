const DEFAULT_OWNER_POINTS_PER_USD = 30;
const DEFAULT_OWNER_MIN_WITHDRAW_POINTS = 15;

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

/**
 * GameVortex Owner Wallet:
 * 30 Owner Points = 1 USD
 * Minimum withdrawal = 15 points = 0.50 USD
 */
export const OWNER_POINTS_PER_USD = positiveIntegerFromEnv(
  process.env.OWNER_POINTS_PER_USD,
  DEFAULT_OWNER_POINTS_PER_USD,
);

export const OWNER_MIN_WITHDRAW_POINTS = positiveIntegerFromEnv(
  process.env.OWNER_MIN_WITHDRAW_POINTS,
  DEFAULT_OWNER_MIN_WITHDRAW_POINTS,
);

export function pointsToUsd(points: number): number {
  if (!Number.isSafeInteger(points) || points < 0) {
    throw new Error("INVALID_OWNER_POINTS");
  }

  return Number((points / OWNER_POINTS_PER_USD).toFixed(2));
}

export function usdToPoints(usd: number): number {
  if (!Number.isFinite(usd) || usd < 0) {
    throw new Error("INVALID_USD_AMOUNT");
  }

  return Math.ceil(usd * OWNER_POINTS_PER_USD);
}

export function validateOwnerWithdrawal(points: number): number {
  if (
    !Number.isSafeInteger(points) ||
    points < OWNER_MIN_WITHDRAW_POINTS
  ) {
    throw new Error("MINIMUM_WITHDRAWAL_NOT_MET");
  }

  const usd = pointsToUsd(points);

  if (usd < 0.5) {
    throw new Error("MINIMUM_WITHDRAWAL_NOT_MET");
  }

  return usd;
}

export function validateOwnerPointsBalance(
  availablePoints: number,
  withdrawalPoints: number,
): void {
  if (
    !Number.isSafeInteger(availablePoints) ||
    availablePoints < 0
  ) {
    throw new Error("INVALID_OWNER_BALANCE");
  }

  if (
    !Number.isSafeInteger(withdrawalPoints) ||
    withdrawalPoints <= 0
  ) {
    throw new Error("INVALID_OWNER_POINTS");
  }

  if (withdrawalPoints > availablePoints) {
    throw new Error("INSUFFICIENT_POINTS");
  }
}

export type OwnerCashSummaryInput = {
  grossUsd: number;
  refundsUsd?: number;
  paidOutUsd?: number;
  pendingOutUsd?: number;
  availablePoints?: number;
  pendingPoints?: number;
};

export type OwnerCashSummary = {
  grossUsd: number;
  refundsUsd: number;
  netRevenueUsd: number;
  paidOutUsd: number;
  pendingOutUsd: number;
  cashAvailableUsd: number;
  pointsBalanceUsd: number;
  pendingPointsUsd: number;
};

export function calculateOwnerCashSummary(
  input: OwnerCashSummaryInput,
): OwnerCashSummary {
  const grossUsd = Number.isFinite(input.grossUsd) ? Number(input.grossUsd) : 0;
  const refundsUsd = Number.isFinite(input.refundsUsd ?? 0) ? Number(input.refundsUsd ?? 0) : 0;
  const paidOutUsd = Number.isFinite(input.paidOutUsd ?? 0) ? Number(input.paidOutUsd ?? 0) : 0;
  const pendingOutUsd = Number.isFinite(input.pendingOutUsd ?? 0) ? Number(input.pendingOutUsd ?? 0) : 0;

  const netRevenueUsd = Number((grossUsd - refundsUsd).toFixed(2));
  const pointsBalance = Number.isSafeInteger(input.availablePoints ?? 0) ? Number(input.availablePoints ?? 0) : 0;
  const pendingPoints = Number.isSafeInteger(input.pendingPoints ?? 0) ? Number(input.pendingPoints ?? 0) : 0;

  const pointsBalanceUsd = pointsBalance > 0 ? Number(pointsToUsd(pointsBalance).toFixed(2)) : 0;
  const pendingPointsUsd = pendingPoints > 0 ? Number(pointsToUsd(pendingPoints).toFixed(2)) : 0;

  const cashAvailableUsd = Number(
    Math.max(netRevenueUsd - paidOutUsd - pendingOutUsd, 0).toFixed(2),
  );

  return {
    grossUsd: Number(grossUsd.toFixed(2)),
    refundsUsd: Number(refundsUsd.toFixed(2)),
    netRevenueUsd,
    paidOutUsd: Number(paidOutUsd.toFixed(2)),
    pendingOutUsd: Number(pendingOutUsd.toFixed(2)),
    cashAvailableUsd,
    pointsBalanceUsd,
    pendingPointsUsd,
  };
}

export type OwnerWithdrawalStatus =
  | "REQUESTED"
  | "PENDING"
  | "PROCESSING"
  | "PAID"
  | "SETTLED"
  | "FAILED"
  | "REJECTED"
  | "CANCELLED"
  | "REVERSED";

export function validateOwnerWithdrawalTransition(
  current: OwnerWithdrawalStatus,
  next: OwnerWithdrawalStatus,
): { releasesPoints: boolean; settlesPayout: boolean } {
  if (["PAID", "SETTLED", "FAILED", "REJECTED", "CANCELLED", "REVERSED"].includes(current)) {
    throw new Error("WITHDRAWAL_ALREADY_FINAL");
  }

  const allowed = current === "PROCESSING"
    ? ["PAID", "SETTLED", "FAILED", "REJECTED", "CANCELLED"]
    : ["PENDING", "PROCESSING", "PAID", "SETTLED", "FAILED", "REJECTED", "CANCELLED"];

  if (!allowed.includes(next)) {
    throw new Error("INVALID_WITHDRAWAL_TRANSITION");
  }

  return {
    releasesPoints: ["FAILED", "REJECTED", "CANCELLED"].includes(next),
    settlesPayout: ["PAID", "SETTLED"].includes(next),
  };
}
