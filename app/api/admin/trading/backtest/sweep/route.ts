import { NextRequest, NextResponse } from "next/server";
import { guardMutation } from "@/lib/api";
import { requireTradingOwner } from "@/lib/trading/access";
import type { BacktestConfig } from "@/lib/trading/backtest";
import { runSweep, type RawCandle } from "@/lib/trading/backtest-sweep";
import { readJsonObject, tradingRouteError } from "@/lib/trading/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CANDLES = 10_000;

function positive(value: unknown, code: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(code);
  return value;
}

function cost(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 5) {
    throw new Error("INVALID_BACKTEST_CONFIG");
  }
  return value;
}

function parseRawCandle(value: unknown): RawCandle {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_BACKTEST_CANDLE");
  const input = value as Record<string, unknown>;
  if (typeof input.timestamp !== "string" || !input.timestamp.trim()) throw new Error("INVALID_BACKTEST_CANDLE");
  return {
    timestamp: input.timestamp,
    open: positive(input.open, "INVALID_BACKTEST_CANDLE"),
    high: positive(input.high, "INVALID_BACKTEST_CANDLE"),
    low: positive(input.low, "INVALID_BACKTEST_CANDLE"),
    close: positive(input.close, "INVALID_BACKTEST_CANDLE"),
    volume: positive(input.volume, "INVALID_BACKTEST_CANDLE"),
  };
}

export async function POST(request: NextRequest) {
  const blocked = await guardMutation(request, "admin:trading:backtest:sweep", 10);
  if (blocked) return blocked;

  let ownerId: string | undefined;
  try {
    const owner = await requireTradingOwner();
    ownerId = owner.id;

    const body = await readJsonObject(request);
    if (typeof body.symbol !== "string" || !body.symbol.trim()) throw new Error("INVALID_BACKTEST_INPUT");
    if (!Array.isArray(body.candles) || body.candles.length === 0 || body.candles.length > MAX_CANDLES) {
      throw new Error("INVALID_BACKTEST_INPUT");
    }
    const config = body.config as Record<string, unknown> | undefined;
    if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("INVALID_BACKTEST_CONFIG");

    const baseConfig: BacktestConfig = {
      initialCapitalUsd: positive(config.initialCapitalUsd, "INVALID_BACKTEST_CONFIG"),
      tradeAmountUsd: positive(config.tradeAmountUsd, "INVALID_BACKTEST_CONFIG"),
      // Overridden per combination by the sweep.
      stopLossPercent: 2,
      takeProfitPercent: 4,
      feePercent: cost(config.feePercent),
      slippagePercent: cost(config.slippagePercent),
    };

    const result = runSweep(body.symbol, body.candles.map(parseRawCandle), baseConfig);
    return NextResponse.json({ ok: true, mode: "BACKTEST_SWEEP", researchOnly: true, result });
  } catch (error) {
    return tradingRouteError(error, "admin:trading:backtest:sweep:post", ownerId);
  }
}
