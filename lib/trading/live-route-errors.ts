import { NextResponse } from "next/server";
import { logSystemError } from "@/lib/observability";
import { tradingErrorStatus, tradingForbidden } from "@/lib/trading/access";

/** Errors that are expected, safe to show, and mean "the request was refused". */
const REFUSED_CODES = new Set([
  "INVALID_LIVE_ORDER_INPUT",
  "INVALID_LIVE_ORDER_SYMBOL",
  "INVALID_LIVE_ORDER_AMOUNT",
  "INVALID_LIVE_ORDER_STOP_LOSS",
  "INVALID_LIVE_ORDER_TAKE_PROFIT",
  "LIVE_OWNER_ACK_REQUIRED",
  "GAMEVORTEX_LIVE_TRADING_DISABLED",
  "LIVE_RISK_CONFIG_REQUIRED",
  "LIVE_MARKET_DATA_UNAVAILABLE",
  "LIVE_WALLET_MODE_REQUIRES_WHOLE_USD",
  "TRADING_ALLOCATION_REQUIRED",
  "BINANCE_LIVE_INSUFFICIENT_BALANCE",
  "BINANCE_LIVE_MIN_NOTIONAL",
  "BINANCE_LIVE_API_CREDENTIALS_REQUIRED",
  "BINANCE_LIVE_NETWORK_ERROR",
  "BINANCE_LIVE_PROVIDER_ERROR",
  "TRADING_CONTROL_BLOCKED",
  "LIVE_RISK_BLOCKED",
  "LIVE_SHARIAH_BLOCKED",
  "SHARIAH_POLICY_NOT_FOUND",
  "PUBLIC_MARKET_DATA_INVALID_SYMBOL",
  "PUBLIC_MARKET_DATA_INVALID_RESPONSE",
  "LIVE_ORDER_NOT_FOUND",
  "LIVE_MONITOR_NO_ACTIVE_ORDER",
  "LIVE_ORDER_STATE_NOT_EXECUTABLE",
  "LIVE_RECONCILIATION_MISMATCH",
  "LIVE_PROTECTION_FAILED",
  "LIVE_ORDER_UNKNOWN",
  "BINANCE_LIVE_PREFLIGHT_BLOCKED",
]);

/**
 * Maps errors of the manual live-order routes to responses. The first segment
 * before ":" is the code; the (short) tail carries details such as risk reasons.
 * Anything unexpected is logged and returned as a generic INTERNAL_ERROR.
 */
export async function liveRouteError(error: unknown, scope: string, userId?: string) {
  const message = error instanceof Error ? error.message : "INTERNAL_ERROR";
  if (message === "FORBIDDEN") return tradingForbidden();

  const known = tradingErrorStatus(message);
  if (known) return NextResponse.json({ error: message }, { status: known });

  const code = message.split(":")[0];
  if (REFUSED_CODES.has(code)) {
    const status = code.startsWith("INVALID_") ? 400 : 409;
    return NextResponse.json({ error: message.slice(0, 400) }, { status });
  }

  await logSystemError(scope, error, { userId });
  return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
}
