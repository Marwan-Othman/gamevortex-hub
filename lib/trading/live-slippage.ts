/**
 * GameVortex AI Trading — live BUY slippage / market-data freshness guards.
 *
 * Pure and side-effect free. The live executor calls these BEFORE a MARKET
 * BUY is submitted (current price vs. the price the owner approved) and AFTER
 * the fill (actual average fill vs. the approved price). Every invalid input
 * fails closed.
 */

export const DEFAULT_LIVE_MAX_SLIPPAGE_PERCENT = 0.5;
export const MIN_LIVE_MAX_SLIPPAGE_PERCENT = 0.05;
export const MAX_LIVE_MAX_SLIPPAGE_PERCENT = 5;
export const LIVE_MARKET_DATA_MAX_AGE_MS = 120_000;

export type SlippageDecision = {
  allowed: boolean;
  slippagePercent: number;
  maxPercent: number;
  reason?: "INVALID_SLIPPAGE_INPUT" | "SLIPPAGE_EXCEEDS_LIMIT";
};

/** Reads TRADING_LIVE_MAX_SLIPPAGE_PERCENT. Unset -> default; invalid -> throws. */
export function resolveMaxSlippagePercent(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_LIVE_MAX_SLIPPAGE_PERCENT;
  const value = Number(raw.trim());
  if (
    !Number.isFinite(value) ||
    value < MIN_LIVE_MAX_SLIPPAGE_PERCENT ||
    value > MAX_LIVE_MAX_SLIPPAGE_PERCENT
  ) {
    throw new Error("INVALID_TRADING_LIVE_MAX_SLIPPAGE_PERCENT");
  }
  return value;
}

/** BUY slippage is adverse only when the observed price is ABOVE the expected price. */
export function evaluateBuySlippage(input: {
  expectedPrice: number;
  observedPrice: number;
  maxPercent: number;
}): SlippageDecision {
  const { expectedPrice, observedPrice, maxPercent } = input;
  const valid = [expectedPrice, observedPrice, maxPercent].every(
    (value) => typeof value === "number" && Number.isFinite(value) && value > 0,
  );
  if (!valid) {
    return { allowed: false, slippagePercent: Number.NaN, maxPercent, reason: "INVALID_SLIPPAGE_INPUT" };
  }

  const slippagePercent = ((observedPrice - expectedPrice) / expectedPrice) * 100;
  if (slippagePercent > maxPercent) {
    return { allowed: false, slippagePercent, maxPercent, reason: "SLIPPAGE_EXCEEDS_LIMIT" };
  }
  return { allowed: true, slippagePercent, maxPercent };
}

/** A market observation is fresh only when its timestamp is valid, not in the future, and recent. */
export function isObservationFresh(
  timestampIso: string,
  nowMs: number,
  maxAgeMs: number = LIVE_MARKET_DATA_MAX_AGE_MS,
): boolean {
  const observed = Date.parse(timestampIso);
  if (!Number.isFinite(observed) || !Number.isFinite(nowMs)) return false;
  const age = nowMs - observed;
  return age >= -5_000 && age <= maxAgeMs;
}
