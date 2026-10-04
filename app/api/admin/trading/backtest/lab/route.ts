import { NextRequest, NextResponse } from "next/server";
import { guardMutation } from "@/lib/api";
import { requireTradingOwner } from "@/lib/trading/access";
import { fetchPublicKlinesPaged, normalizePublicSymbol } from "@/lib/trading/binance-public-market-data";
import { readJsonObject, tradingRouteError } from "@/lib/trading/route-helpers";
import { runStrategyLab, type LabConfig } from "@/lib/trading/strategy-lab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEFAULT_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];
const INTERVALS = new Set(["15m", "1h", "4h"]);

const STATUS_BY_CODE: Record<string, number> = {
  PUBLIC_MARKET_DATA_INVALID_SYMBOL: 400,
  PUBLIC_MARKET_DATA_INVALID_INTERVAL: 400,
  PUBLIC_MARKET_DATA_INVALID_LIMIT: 400,
  PUBLIC_MARKET_DATA_SYMBOL_NOT_FOUND: 404,
  PUBLIC_MARKET_DATA_RATE_LIMITED: 429,
  PUBLIC_MARKET_DATA_REGION_BLOCKED: 502,
  PUBLIC_MARKET_DATA_NETWORK_ERROR: 502,
  PUBLIC_MARKET_DATA_PROVIDER_ERROR: 502,
  PUBLIC_MARKET_DATA_INVALID_RESPONSE: 502,
  INVALID_BACKTEST_INPUT: 400,
  INVALID_BACKTEST_CANDLE: 400,
  INVALID_BACKTEST_CONFIG: 400,
  INVALID_BACKTEST_TIMESTAMP_ORDER: 400,
};

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export async function POST(request: NextRequest) {
  const blocked = await guardMutation(request, "admin:trading:backtest:lab", 5);
  if (blocked) return blocked;

  let ownerId: string | undefined;
  try {
    const owner = await requireTradingOwner();
    ownerId = owner.id;

    const body = await readJsonObject(request);
    const interval = typeof body.interval === "string" ? body.interval : "1h";
    if (!INTERVALS.has(interval)) throw new Error("PUBLIC_MARKET_DATA_INVALID_INTERVAL");
    const count = Math.trunc(numberOr(body.candles, 5000));
    if (count < 1000 || count > 5000) throw new Error("PUBLIC_MARKET_DATA_INVALID_LIMIT");

    const symbolsInput = Array.isArray(body.symbols) && body.symbols.length > 0 ? body.symbols : DEFAULT_SYMBOLS;
    if (symbolsInput.length > 4) throw new Error("INVALID_BACKTEST_INPUT");
    const symbols = Array.from(new Set(symbolsInput.map((s) => normalizePublicSymbol(String(s)))));

    const config: LabConfig = {
      initialCapitalUsd: numberOr(body.initialCapitalUsd, 100),
      tradeAmountUsd: numberOr(body.tradeAmountUsd, 10),
      feePercent: numberOr(body.feePercent, 0.1),
      slippagePercent: numberOr(body.slippagePercent, 0.05),
    };

    const datasets = await Promise.all(
      symbols.map(async (symbol) => ({ symbol, candles: await fetchPublicKlinesPaged(symbol, interval, count) })),
    );
    const result = runStrategyLab(datasets, config);

    return NextResponse.json({ ok: true, mode: "STRATEGY_LAB", researchOnly: true, symbols, interval, result });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (STATUS_BY_CODE[code]) return NextResponse.json({ error: code }, { status: STATUS_BY_CODE[code] });
    return tradingRouteError(error, "admin:trading:backtest:lab:post", ownerId);
  }
}
