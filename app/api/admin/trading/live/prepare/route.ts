import { NextRequest, NextResponse } from "next/server";
import { guardMutation } from "@/lib/api";
import { requireTradingOwner } from "@/lib/trading/access";
import { prepareLiveOrder } from "@/lib/trading/live-prepare";
import { liveRouteError } from "@/lib/trading/live-route-errors";
import { readJsonObject } from "@/lib/trading/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/admin/trading/live/prepare
 * Owner only. Body: { symbol, amountUsd, stopLossPercent, takeProfitPercent, ackOwnerSpot }.
 *
 * Runs every pre-trade check and creates a short-lived owner approval. It
 * NEVER sends an order to Binance: the real BUY needs the approval to be
 * consumed and the typed confirmation sent to /live/execute.
 */
export async function POST(request: NextRequest) {
  const blocked = await guardMutation(request, "admin:trading:live:prepare", 6);
  if (blocked) return blocked;

  let ownerId: string | undefined;
  try {
    const owner = await requireTradingOwner();
    ownerId = owner.id;
    const body = await readJsonObject(request);

    const prepared = await prepareLiveOrder({
      ownerId: owner.id,
      symbol: body.symbol,
      amountUsd: body.amountUsd,
      stopLossPercent: body.stopLossPercent,
      takeProfitPercent: body.takeProfitPercent,
      ackOwnerSpot: body.ackOwnerSpot,
    });

    return NextResponse.json({ ok: true, realMoney: false, ...prepared });
  } catch (error) {
    return liveRouteError(error, "admin:trading:live:prepare:post", ownerId);
  }
}
