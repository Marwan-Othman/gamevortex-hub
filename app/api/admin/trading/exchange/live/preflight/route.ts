import { NextResponse } from "next/server";
import { requireTradingOwner } from "@/lib/trading/access";
import { getBinanceLivePreflight } from "@/lib/trading/binance-live-preflight";
import { tradingRouteError } from "@/lib/trading/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only production exchange preflight.
 *
 * This endpoint never creates, modifies, cancels, or withdraws an order. It
 * only verifies server-side credentials and Binance account/API-key safety
 * restrictions needed before a separately reviewed live executor can exist.
 */
export async function GET() {
  let ownerId: string | undefined;
  try {
    const owner = await requireTradingOwner();
    ownerId = owner.id;

    const preflight = await getBinanceLivePreflight();
    return NextResponse.json({
      ok: true,
      venue: "BINANCE_SPOT_LIVE",
      readOnly: true,
      realMoney: false,
      ...preflight,
    });
  } catch (error) {
    return tradingRouteError(error, "admin:trading:exchange:live:preflight:get", ownerId);
  }
}
