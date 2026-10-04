import { NextRequest, NextResponse } from "next/server";
import { requireTradingOwner } from "@/lib/trading/access";
import { fetchPublicKlines } from "@/lib/trading/binance-public-market-data";
import { tradingRouteError } from "@/lib/trading/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS_BY_CODE: Record<string, number> = {
  PUBLIC_MARKET_DATA_INVALID_SYMBOL: 400,
  PUBLIC_MARKET_DATA_INVALID_INTERVAL: 400,
  PUBLIC_MARKET_DATA_INVALID_LIMIT: 400,
  PUBLIC_MARKET_DATA_INVALID_END_TIME: 400,
  PUBLIC_MARKET_DATA_SYMBOL_NOT_FOUND: 404,
  PUBLIC_MARKET_DATA_RATE_LIMITED: 429,
  PUBLIC_MARKET_DATA_REGION_BLOCKED: 502,
  PUBLIC_MARKET_DATA_NETWORK_ERROR: 502,
  PUBLIC_MARKET_DATA_PROVIDER_ERROR: 502,
  PUBLIC_MARKET_DATA_INVALID_RESPONSE: 502,
};

export async function GET(request: NextRequest) {
  let ownerId: string | undefined;
  try {
    const owner = await requireTradingOwner();
    ownerId = owner.id;

    const params = request.nextUrl.searchParams;
    const endTimeRaw = params.get("endTime");
    const result = await fetchPublicKlines({
      symbol: params.get("symbol")?.trim() || "BTC/USDT",
      interval: params.get("interval")?.trim() || "1h",
      limit: Number(params.get("limit") ?? "1000"),
      endTimeMs: endTimeRaw ? Number(endTimeRaw) : undefined,
    });

    return NextResponse.json({
      ok: true,
      source: "BINANCE_PUBLIC_MARKET_DATA",
      readOnly: true,
      symbol: result.symbol,
      interval: result.interval,
      candles: result.candles,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (STATUS_BY_CODE[code]) {
      return NextResponse.json({ error: code }, { status: STATUS_BY_CODE[code] });
    }
    return tradingRouteError(error, "admin:trading:exchange:public:market-data:get", ownerId);
  }
}
