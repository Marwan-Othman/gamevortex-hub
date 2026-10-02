import { describe, expect, it } from "vitest";
import {
  buildMarketSnapshot,
  calculateLiquidityScore,
  calculateVolatilityPercent,
  type MarketCandle,
} from "./market-data";

const candles: MarketCandle[] = [
  { timestamp: "2026-10-01T10:00:00.000Z", open: 100, high: 102, low: 99, close: 101, volume: 1000 },
  { timestamp: "2026-10-01T10:01:00.000Z", open: 101, high: 104, low: 100, close: 103, volume: 1200 },
  { timestamp: "2026-10-01T10:02:00.000Z", open: 103, high: 105, low: 102, close: 104, volume: 1400 },
];

describe("market-data", () => {
  it("normalizes the newest candle into a market snapshot", () => {
    const snapshot = buildMarketSnapshot(" test ", candles);

    expect(snapshot.symbol).toBe("TEST");
    expect(snapshot.price).toBe(104);
    expect(snapshot.previousPrice).toBe(103);
    expect(snapshot.volume).toBe(1400);
    expect(snapshot.averageVolume).toBe(1200);
    expect(snapshot.volatilityPercent).toBeGreaterThan(0);
    expect(snapshot.liquidityScore).toBeGreaterThan(0);
    expect(snapshot.liquidityScore).toBeLessThanOrEqual(100);
  });

  it("returns zero volatility when there is only one candle", () => {
    expect(calculateVolatilityPercent([candles[0]])).toBe(0);
  });

  it("returns a bounded liquidity score", () => {
    const score = calculateLiquidityScore(candles);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("rejects invalid OHLC relationships", () => {
    expect(() =>
      buildMarketSnapshot("TEST", [
        { ...candles[0], high: 98 },
      ]),
    ).toThrow("INVALID_MARKET_CANDLE_HIGH");
  });

  it("rejects non-chronological data", () => {
    expect(() => buildMarketSnapshot("TEST", [candles[1], candles[0]])).toThrow(
      "MARKET_DATA_NOT_CHRONOLOGICAL",
    );
  });

  it("rejects invalid symbols", () => {
    expect(() => buildMarketSnapshot("bad symbol", candles)).toThrow("INVALID_MARKET_SYMBOL");
  });

  it("rejects an empty candle timestamp", () => {
    expect(() =>
      buildMarketSnapshot("TEST", [
        { ...candles[0], timestamp: "" },
      ]),
    ).toThrow("INVALID_MARKET_CANDLE_TIMESTAMP");
  });

  it("rejects negative volume", () => {
    expect(() =>
      buildMarketSnapshot("TEST", [
        { ...candles[0], volume: -1 },
      ]),
    ).toThrow("INVALID_MARKET_CANDLE_VALUES");
  });

  it("rejects a low price above the open or close", () => {
    expect(() =>
      buildMarketSnapshot("TEST", [
        { ...candles[0], low: 102 },
      ]),
    ).toThrow("INVALID_MARKET_CANDLE_LOW");
  });

  it("rejects duplicate timestamps", () => {
    expect(() =>
      buildMarketSnapshot("TEST", [
        candles[0],
        { ...candles[1], timestamp: candles[0].timestamp },
      ]),
    ).toThrow("MARKET_DATA_NOT_CHRONOLOGICAL");
  });

  it("preserves valid punctuation in normalized symbols", () => {
    const snapshot = buildMarketSnapshot(" btc-usdt ", [candles[0]]);
    expect(snapshot.symbol).toBe("BTC-USDT");
  });

  it("returns zero liquidity when all traded volume is zero", () => {
    const zeroVolumeCandles = candles.map((candle) => ({ ...candle, volume: 0 }));
    expect(calculateLiquidityScore(zeroVolumeCandles)).toBe(0);
  });
});
