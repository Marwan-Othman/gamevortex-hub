import { NextRequest, NextResponse } from "next/server";
import { guardMutation } from "@/lib/api";
import { requireTradingOwner } from "@/lib/trading/access";
import { runBacktest, type BacktestCandle, type BacktestConfig } from "@/lib/trading/backtest";
import { readJsonObject, tradingRouteError } from "@/lib/trading/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_CANDLES = 10_000;

function parseFinitePositive(value: unknown, code: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(code);
  }
  return value;
}

function parseCandle(value: unknown): BacktestCandle {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_BACKTEST_CANDLE");
  }

  const input = value as Record<string, unknown>;
  if (typeof input.timestamp !== "string" || !input.timestamp.trim()) {
    throw new Error("INVALID_BACKTEST_CANDLE");
  }

  return {
    timestamp: input.timestamp,
    open: parseFinitePositive(input.open, "INVALID_BACKTEST_CANDLE"),
    high: parseFinitePositive(input.high, "INVALID_BACKTEST_CANDLE"),
    low: parseFinitePositive(input.low, "INVALID_BACKTEST_CANDLE"),
    close: parseFinitePositive(input.close, "INVALID_BACKTEST_CANDLE"),
    volume: parseFinitePositive(input.volume, "INVALID_BACKTEST_CANDLE"),
    fastAverage: parseFinitePositive(input.fastAverage, "INVALID_BACKTEST_CANDLE"),
    slowAverage: parseFinitePositive(input.slowAverage, "INVALID_BACKTEST_CANDLE"),
    averageVolume: parseFinitePositive(input.averageVolume, "INVALID_BACKTEST_CANDLE"),
  };
}

function parseConfig(value: unknown): BacktestConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_BACKTEST_CONFIG");
  }

  const input = value as Record<string, unknown>;
  return {
    initialCapitalUsd: parseFinitePositive(input.initialCapitalUsd, "INVALID_BACKTEST_CONFIG"),
    tradeAmountUsd: parseFinitePositive(input.tradeAmountUsd, "INVALID_BACKTEST_CONFIG"),
    stopLossPercent: parseFinitePositive(input.stopLossPercent, "INVALID_BACKTEST_CONFIG"),
    takeProfitPercent: parseFinitePositive(input.takeProfitPercent, "INVALID_BACKTEST_CONFIG"),
  };
}

export async function POST(request: NextRequest) {
  const blocked = await guardMutation(request, "admin:trading:backtest", 10);
  if (blocked) return blocked;

  let ownerId: string | undefined;
  try {
    const owner = await requireTradingOwner();
    ownerId = owner.id;

    const body = await readJsonObject(request);
    if (typeof body.symbol !== "string" || !body.symbol.trim()) {
      throw new Error("INVALID_BACKTEST_INPUT");
    }
    if (!Array.isArray(body.candles) || body.candles.length === 0 || body.candles.length > MAX_CANDLES) {
      throw new Error("INVALID_BACKTEST_INPUT");
    }

    const candles = body.candles.map(parseCandle);
    const config = parseConfig(body.config);
    const result = runBacktest(body.symbol, candles, config);

    return NextResponse.json({
      ok: true,
      mode: "BACKTEST",
      researchOnly: true,
      result,
    });
  } catch (error) {
    return tradingRouteError(error, "admin:trading:backtest:post", ownerId);
  }
}
