import { describe, expect, it } from "vitest";
import {
  buildLiveRiskSnapshot,
  buildMarketSnapshot,
  normalizeLiveSymbol,
  parseLiveAmountUsd,
  type LiveOrderForRisk,
  type PrepareCandle,
} from "@/lib/trading/live-prepare-math";
import { isLiveDirectFundingEnabled } from "@/lib/trading/live-direct-funding";

function candles(count: number, close = (i: number) => 100 + i, volume = () => 10): PrepareCandle[] {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: new Date(1_700_000_000_000 + i * 300_000).toISOString(),
    open: close(i), high: close(i), low: close(i), close: close(i), volume: volume(),
  }));
}

const NOW = new Date("2026-10-05T12:00:00.000Z");
const order = (o: Partial<LiveOrderForRisk>): LiveOrderForRisk => ({
  symbol: "BTCUSDT", amountUsd: 10, status: "CLOSED", realizedPnlUsd: 0,
  updatedAt: new Date("2026-10-05T08:00:00.000Z"), ...o,
});

describe("manual live order helpers", () => {
  it("builds a market snapshot with positive values", () => {
    const s = buildMarketSnapshot(candles(60));
    expect(s.price).toBe(159);
    expect(s.previousPrice).toBe(158);
    expect(s.fastAverage).toBeCloseTo(154.5);
    expect(s.slowAverage).toBeCloseTo(144.5);
    expect(s.volume).toBe(10);
  });
  it("rejects too few candles and falls back when last volume is zero", () => {
    expect(() => buildMarketSnapshot(candles(10))).toThrow("LIVE_MARKET_DATA_UNAVAILABLE");
    const c = candles(60); c[59] = { ...c[59], volume: 0 };
    expect(buildMarketSnapshot(c).volume).toBe(10);
  });
  it("counts open trades and exposure, ignores INTENT_CREATED", () => {
    const r = buildLiveRiskSnapshot(
      [order({ status: "PROTECTED" }), order({ status: "INTENT_CREATED" }), order({ status: "UNKNOWN", symbol: "ETHUSDT", amountUsd: 5 })],
      { symbol: "btcusdt", requestedAmountUsd: 10, hasStopLoss: true, hasTakeProfit: true, now: NOW });
    expect(r.openTrades).toBe(2);
    expect(r.totalExposureUsd).toBe(15);
    expect(r.assetExposureUsd).toBe(10);
  });
  it("computes today's net loss and consecutive losses", () => {
    const r = buildLiveRiskSnapshot(
      [order({ realizedPnlUsd: -0.5, updatedAt: new Date("2026-10-05T10:00:00Z") }),
       order({ realizedPnlUsd: -0.25, updatedAt: new Date("2026-10-05T09:00:00Z") }),
       order({ realizedPnlUsd: 0.1, updatedAt: new Date("2026-10-04T09:00:00Z") })],
      { symbol: "BTCUSDT", requestedAmountUsd: 10, hasStopLoss: true, hasTakeProfit: true, now: NOW });
    expect(r.dailyLossUsd).toBeCloseTo(0.75);
    expect(r.consecutiveLosses).toBe(2);
  });
  it("validates symbol and amount", () => {
    expect(normalizeLiveSymbol("btc/usdt")).toBe("BTCUSDT");
    expect(() => normalizeLiveSymbol("BTC/USD")).toThrow("INVALID_LIVE_ORDER_SYMBOL");
    expect(parseLiveAmountUsd("10")).toBe(10);
    expect(() => parseLiveAmountUsd(0.5)).toThrow("INVALID_LIVE_ORDER_AMOUNT");
    expect(() => parseLiveAmountUsd(5.123)).toThrow("INVALID_LIVE_ORDER_AMOUNT");
  });
  it("direct funding is opt-in with the exact string true", () => {
    expect(isLiveDirectFundingEnabled({})).toBe(false);
    expect(isLiveDirectFundingEnabled({ GAMEVORTEX_LIVE_DIRECT_FUNDING: "TRUE" })).toBe(false);
    expect(isLiveDirectFundingEnabled({ GAMEVORTEX_LIVE_DIRECT_FUNDING: "true" })).toBe(true);
  });
});
