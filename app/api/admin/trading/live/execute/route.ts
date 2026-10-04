import { NextRequest, NextResponse } from "next/server";
import { guardMutation } from "@/lib/api";
import { logSystemError } from "@/lib/observability";
import { requireTradingOwner, tradingErrorStatus, tradingForbidden } from "@/lib/trading/access";
import { executeApprovedLiveOrder } from "@/lib/trading/live-production-executor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Typed confirmation the owner must send for every real-money order. */
const CONFIRMATION_TEXT = "EXECUTE LIVE ORDER";

/** Executor errors whose message carries a detail suffix after ":". */
const CONFLICT_PREFIXES = [
  "TRADING_CONTROL_BLOCKED",
  "BINANCE_LIVE_PREFLIGHT_BLOCKED",
  "LIVE_RISK_BLOCKED",
  "LIVE_SHARIAH_BLOCKED",
  "LIVE_SLIPPAGE_BLOCKED",
  "LIVE_ORDER_UNKNOWN",
  "LIVE_PROTECTION_FAILED",
  "LIVE_RECONCILIATION_MISMATCH",
  "LIVE_ORDER_STATE_NOT_EXECUTABLE",
];

const CONFLICT_CODES = new Set([
  "LIVE_MARKET_DATA_STALE",
  "LIVE_RISK_CONFIG_REQUIRED",
  "LIVE_TRADING_DISABLED",
  "OWNER_APPROVAL_NOT_CONSUMED",
  "APPROVAL_EXPIRED",
  "SHARIAH_APPROVAL_REQUIRED",
  "INVALID_TRADING_LIVE_MAX_SLIPPAGE_PERCENT",
]);

/**
 * POST /api/admin/trading/live/execute
 * Owner only. Body: { approvalId, opportunityId, confirm: "EXECUTE LIVE ORDER" }
 * Submits at most ONE real-money BUY for an already consumed owner approval.
 * Idempotent per approval: calling it again only reconciles the same order.
 */
export async function POST(request: NextRequest) {
  const blocked = await guardMutation(request, "admin:trading:live:execute", 3);
  if (blocked) return blocked;

  let ownerId: string | undefined;
  try {
    const owner = await requireTradingOwner();
    ownerId = owner.id;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new Error("INVALID_JSON");
    }

    const raw = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const approvalId = typeof raw.approvalId === "string" ? raw.approvalId.trim() : "";
    const opportunityId = typeof raw.opportunityId === "string" ? raw.opportunityId.trim() : "";
    if (!approvalId || !opportunityId) throw new Error("INVALID_APPROVAL_INPUT");
    if (raw.confirm !== CONFIRMATION_TEXT) throw new Error("CONFIRMATION_REQUIRED");

    if (process.env.GAMEVORTEX_LIVE_TRADING_ENABLED !== "true") {
      throw new Error("GAMEVORTEX_LIVE_TRADING_DISABLED");
    }

    const result = await executeApprovedLiveOrder({
      ownerId: owner.id,
      approvalId,
      opportunityId,
      mode: "execute",
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "INTERNAL_ERROR";
    if (message === "FORBIDDEN") return tradingForbidden();

    const known = tradingErrorStatus(message);
    if (known) return NextResponse.json({ error: message }, { status: known });

    const code = message.split(":")[0];
    if (CONFLICT_CODES.has(message) || CONFLICT_PREFIXES.includes(code)) {
      return NextResponse.json({ error: message.slice(0, 400) }, { status: 409 });
    }

    await logSystemError("admin:trading:live:execute", error, { userId: ownerId });
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
