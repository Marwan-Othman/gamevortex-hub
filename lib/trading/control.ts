/**
 * GameVortex AI Trading — Emergency Stop + Circuit Breaker (pure rules).
 *
 * Fail closed: if the control state cannot be read (missing), trading is blocked.
 * The Trading Executor must call isTradingBlocked() before sending any order.
 */

export const CIRCUIT_BREAKER_REASONS = [
  "API_ERROR",
  "MARKET_DATA_ERROR",
  "PRICE_ANOMALY",
  "ORDER_FAILURE",
  "RISK_VIOLATION",
  "SHARIAH_CHECK_FAILURE",
  "UNEXPECTED_SYSTEM_ERROR",
] as const;

export type CircuitBreakerReason = (typeof CIRCUIT_BREAKER_REASONS)[number];

export type TradingControlState = {
  emergencyStopped: boolean;
  circuitBreakerReasons: readonly string[];
};

export function isCircuitBreakerReason(value: unknown): value is CircuitBreakerReason {
  return typeof value === "string" && (CIRCUIT_BREAKER_REASONS as readonly string[]).includes(value);
}

/**
 * Reasons why NEW trading is blocked. Empty array = control state allows trading
 * (other gates — Shariah, Risk, Approval — still apply independently).
 */
export function controlBlockReasons(state: TradingControlState | null | undefined): string[] {
  if (!state || typeof state !== "object") return ["TRADING_CONTROL_MISSING"];

  const reasons: string[] = [];
  // Anything other than an explicit `false` counts as stopped.
  if (state.emergencyStopped !== false) reasons.push("EMERGENCY_STOP_ACTIVE");

  const breakers = Array.isArray(state.circuitBreakerReasons) ? state.circuitBreakerReasons : null;
  if (!breakers) {
    reasons.push("CIRCUIT_BREAKER_STATE_INVALID");
  } else {
    // Any entry blocks, including ones this code version does not know.
    for (const reason of breakers) reasons.push(`CIRCUIT_BREAKER:${String(reason)}`);
  }

  return reasons;
}

export function isTradingBlocked(state: TradingControlState | null | undefined): boolean {
  return controlBlockReasons(state).length > 0;
}
