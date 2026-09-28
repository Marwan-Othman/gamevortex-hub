import { NextResponse } from "next/server";
import { getOptionalUser } from "../auth";
import { logEvent } from "../observability";

/**
 * Server-side gate for every GameVortex AI Trading API route (Tasks 3, 4, 6).
 *
 * - Authorization is role === SUPER_ADMIN only. Never email / username.
 * - Any unauthorized attempt (logged out, USER, STAFF, ...) returns 403.
 *   The response is identical for all of them so the endpoint does not
 *   reveal whether a session exists.
 */
export class TradingAccessError extends Error {
  constructor() {
    super("FORBIDDEN");
  }
}

export async function requireTradingOwner() {
  const user = await getOptionalUser();

  if (!user || user.role !== "SUPER_ADMIN") {
    if (user) {
      // Metadata only: no secrets, no request body.
      logEvent("trading_access_denied", { userId: user.id, role: user.role });
    }
    throw new TradingAccessError();
  }

  return user;
}

export function tradingForbidden() {
  return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
}

const CLIENT_ERROR_STATUS: Record<string, number> = {
  INVALID_JSON: 400,
  INVALID_ALLOCATION_AMOUNT: 400,
  ALLOCATION_MUST_BE_WHOLE_USD: 400,
  ALLOCATION_BELOW_MINIMUM: 400,
  ALLOCATION_ABOVE_MAXIMUM: 400,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  OWNER_WALLET_NOT_FOUND: 404,
  ALLOCATION_NOT_FOUND: 404,
  INSUFFICIENT_POINTS: 409,
  IDEMPOTENCY_KEY_CONFLICT: 409,
  ALLOCATION_ALREADY_RELEASED: 409,
  ALLOCATION_IN_USE: 409,
  INSUFFICIENT_TRADING_BALANCE: 409,
  // Phase 2b
  INVALID_RISK_CONFIG: 400,
  INVALID_SHARIAH_INPUT: 400,
  INVALID_CONTROL_ACTION: 400,
  INVALID_CIRCUIT_BREAKER_REASON: 400,
  CONFIRMATION_REQUIRED: 400,
  SHARIAH_POLICY_NOT_FOUND: 409,
};

export function tradingErrorStatus(message: string): number | null {
  return CLIENT_ERROR_STATUS[message] ?? null;
}
