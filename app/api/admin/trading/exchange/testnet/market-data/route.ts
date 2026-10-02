import { NextRequest, NextResponse } from "next/server";
import { requireTradingOwner } from "@/lib/trading/access";
import { BinanceSpotTestnetAdapter } from "@/lib/trading/binance-spot-testnet-adapter";
import { tradingRouteError } from "@/lib/trading/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_SYMBOL = "BTC/USDT";
const DEFAULT_INTERVAL = "5m";
const MAX_LIMIT = 500;

function parseLimit(value: string | null): number {
  const limit = Number(value ?? "100");
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new Error("INVALID_MARKET_DATA_LIMIT");
  }
  return limit;
}

export async function GET(request: NextRequest) {
  let ownerId: string | undefined;
  try {
    const owner = await requireTradingOwner();
    ownerId = owner.id;

    const symbol = request.nextUrl.searchParams.get("symbol")?.trim() || DEFAULT_SYMBOL;
    const interval = request.nextUrl.searchParams.get("interval")?.trim() || DEFAULT_INTERVAL;
    const limit = parseLimit(request.nextUrl.searchParams.get("limit"));

    const adapter = new BinanceSpotTestnetAdapter();
    const result = await adapter.getMarketData({ symbol, interval, limit });

    return NextResponse.json({
      ok: true,
      source: "BINANCE_SPOT_TESTNET",
      simulationOnly: true,
      symbol: result.symbol,
      interval: result.interval,
      candles: result.candles,
    });
  } catch (error) {
    return tradingRouteError(error, "admin:trading:exchange:testnet:market-data:get", ownerId);
  }
}
