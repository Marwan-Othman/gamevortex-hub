/**
 * GameVortex AI Trading — money rules for Trading Wallet Allocation.
 *
 * Allocations are WHOLE USD amounts (the owner examples are $1/$5/$10/$50/$100)
 * so the conversion Owner Points <-> USD is always exact (no rounding dust):
 *   points = usd * pointsPerUsd
 */

export const TRADING_MIN_ALLOCATION_USD = 1;
export const TRADING_DEFAULT_MAX_ALLOCATION_USD = 1000;

export function tradingMaxAllocationUsd(
  env: string | undefined = process.env.TRADING_MAX_ALLOCATION_USD,
): number {
  const parsed = Number(env);
  if (!Number.isSafeInteger(parsed) || parsed < TRADING_MIN_ALLOCATION_USD) {
    return TRADING_DEFAULT_MAX_ALLOCATION_USD;
  }
  return parsed;
}

export function validateAllocationUsd(
  amountUsd: unknown,
  maxUsd: number = tradingMaxAllocationUsd(),
): number {
  if (typeof amountUsd !== "number" || !Number.isFinite(amountUsd)) {
    throw new Error("INVALID_ALLOCATION_AMOUNT");
  }
  if (!Number.isInteger(amountUsd)) {
    throw new Error("ALLOCATION_MUST_BE_WHOLE_USD");
  }
  if (amountUsd < TRADING_MIN_ALLOCATION_USD) {
    throw new Error("ALLOCATION_BELOW_MINIMUM");
  }
  if (amountUsd > maxUsd) {
    throw new Error("ALLOCATION_ABOVE_MAXIMUM");
  }
  return amountUsd;
}

export function allocationPoints(amountUsd: number, pointsPerUsd: number): number {
  if (!Number.isSafeInteger(pointsPerUsd) || pointsPerUsd <= 0) {
    throw new Error("INVALID_CONVERSION_RATE");
  }
  const points = amountUsd * pointsPerUsd;
  if (!Number.isSafeInteger(points) || points <= 0) {
    throw new Error("INVALID_ALLOCATION_AMOUNT");
  }
  return points;
}

export function validateIdempotencyKey(value: unknown): string {
  const key = typeof value === "string" ? value.trim() : "";
  if (key.length < 8 || key.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    throw new Error("IDEMPOTENCY_KEY_REQUIRED");
  }
  return key;
}
