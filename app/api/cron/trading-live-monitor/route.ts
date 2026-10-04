import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { logSystemError } from "@/lib/observability";
import { listMonitorableLiveOrders } from "@/lib/trading/live-order-state";
import { executeApprovedLiveOrder } from "@/lib/trading/live-production-executor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_ORDERS_PER_RUN = 10;

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  // A missing or short secret disables the endpoint entirely.
  if (!secret || secret.length < 16) return false;
  const header = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * GET /api/cron/trading-live-monitor
 * Reconciles, protects and settles EXISTING live orders. It runs the executor
 * in "monitor" mode, which can never submit a new BUY.
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically.
 */
export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  // Without the live flag the adapter would throw for every order and the
  // executor would wrongly mark them UNKNOWN. Do nothing instead.
  if (process.env.GAMEVORTEX_LIVE_TRADING_ENABLED !== "true") {
    return NextResponse.json({ ok: true, skipped: "LIVE_TRADING_DISABLED", processed: 0 });
  }

  try {
    const orders = await listMonitorableLiveOrders(MAX_ORDERS_PER_RUN);
    const results: Array<Record<string, unknown>> = [];

    for (const order of orders) {
      try {
        const outcome = await executeApprovedLiveOrder({
          ownerId: order.ownerId,
          approvalId: order.approvalId,
          opportunityId: order.opportunityId,
          mode: "monitor",
        });
        results.push({
          orderId: order.id,
          status: outcome.status,
          settlementStatus: outcome.settlementStatus,
          blockers: outcome.blockers,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 300) : "MONITOR_FAILED";
        results.push({ orderId: order.id, error: message });
      }
    }

    return NextResponse.json({ ok: true, processed: orders.length, results });
  } catch (error) {
    await logSystemError("cron:trading-live-monitor", error);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
