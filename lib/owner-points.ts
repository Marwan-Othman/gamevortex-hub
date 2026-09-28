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
