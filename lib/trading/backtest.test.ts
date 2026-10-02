import { describe, expect, it } from "vitest";
import { runBacktest } from "./backtest";

const config = {
  initialCapitalUsd: 100,
  tradeAmountUsd: 10,
  stopLossPercent: 2,
  takeProfitPercent: 4,
};

const candle = (timestamp: string) => ({
  timestamp,
  open: 100,
  high: 101,
  low: 99,
  close: 100,
  volume: 1000,
  fastAverage: 99,
  slowAverage: 98,
  averageVolume: 900,
});

describe("runBacktest", () => {
  it("takes profit deterministically", () => {
    const result = runBacktest("TEST", [
      candle("2026-01-01T00:00:00Z"),
      {
        timestamp: "2026-01-01T00:05:00Z",
        open: 100,
        high: 110,
        low: 100,
        close: 110,
        volume: 1200,
        fastAverage: 108,
        slowAverage: 100,
        averageVolume: 1000,
      },
      {
        timestamp: "2026-01-01T00:10:00Z",
        open: 110,
        high: 115,
        low: 109,
        close: 114.4,
        volume: 1300,
        fastAverage: 112,
        slowAverage: 105,
        averageVolume: 1000,
      },
    ], config);

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].exitReason).toBe("TAKE_PROFIT");
    expect(result.trades[0].pnlUsd).toBeCloseTo(0.4, 8);
    expect(result.finalCapitalUsd).toBeCloseTo(100.4, 8);
    expect(result.totalTrades).toBe(1);
    expect(result.winningTrades).toBe(1);
    expect(result.losingTrades).toBe(0);
    expect(result.winRatePercent).toBe(100);
    expect(result.grossProfitUsd).toBeCloseTo(0.4, 8);
    expect(result.grossLossUsd).toBe(0);
    expect(result.profitFactor).toBeNull();
    expect(result.maxDrawdownUsd).toBe(0);
    expect(result.maxDrawdownPercent).toBe(0);
  });

  it("uses stop loss when both stop and target are touched in one candle", () => {
    const result = runBacktest("TEST", [
      candle("2026-01-01T00:00:00Z"),
      {
        timestamp: "2026-01-01T00:05:00Z",
        open: 100,
        high: 110,
        low: 100,
        close: 110,
        volume: 1200,
        fastAverage: 108,
        slowAverage: 100,
        averageVolume: 1000,
      },
      {
        timestamp: "2026-01-01T00:10:00Z",
        open: 110,
        high: 115,
        low: 107,
        close: 110,
        volume: 1300,
        fastAverage: 112,
        slowAverage: 105,
        averageVolume: 1000,
      },
    ], config);

    expect(result.trades[0].exitReason).toBe("STOP_LOSS");
    expect(result.trades[0].exitPrice).toBeCloseTo(107.8, 8);
    expect(result.losingTrades).toBe(1);
    expect(result.winRatePercent).toBe(0);
    expect(result.grossProfitUsd).toBe(0);
    expect(result.grossLossUsd).toBeCloseTo(0.2, 8);
    expect(result.profitFactor).toBe(0);
    expect(result.maxDrawdownUsd).toBeGreaterThan(0);
    expect(result.maxDrawdownPercent).toBeGreaterThan(0);
  });

  it("rejects invalid backtest configuration and input", () => {
    expect(() => runBacktest("TEST", [], config)).toThrow("INVALID_BACKTEST_INPUT");
    expect(() => runBacktest("TEST", [candle("2026-01-01T00:00:00Z")], {
      ...config,
      tradeAmountUsd: 101,
    })).toThrow("INVALID_BACKTEST_CONFIG");
    expect(() => runBacktest("TEST", [candle("2026-01-01T00:00:00Z")], {
      ...config,
      tradeAmountUsd: 0.99,
    })).toThrow("INVALID_BACKTEST_CONFIG");
    expect(() => runBacktest("INVALID SYMBOL", [candle("2026-01-01T00:00:00Z")], config)).toThrow(
      "INVALID_BACKTEST_INPUT",
    );
  });

  it("rejects invalid timestamp ordering", () => {
    expect(() => runBacktest("TEST", [
      candle("2026-01-01T00:05:00Z"),
      candle("2026-01-01T00:05:00Z"),
    ], config)).toThrow("INVALID_BACKTEST_TIMESTAMP_ORDER");

    expect(() => runBacktest("TEST", [
      candle("2026-01-01T00:10:00Z"),
      candle("2026-01-01T00:05:00Z"),
    ], config)).toThrow("INVALID_BACKTEST_TIMESTAMP_ORDER");
  });

  it("rejects malformed market candles", () => {
    expect(() => runBacktest("TEST", [
      { ...candle("2026-01-01T00:00:00Z"), timestamp: "not-a-date" },
      candle("2026-01-01T00:05:00Z"),
    ], config)).toThrow("INVALID_BACKTEST_CANDLE");

    expect(() => runBacktest("TEST", [
      { ...candle("2026-01-01T00:00:00Z"), high: 98 },
      candle("2026-01-01T00:05:00Z"),
    ], config)).toThrow("INVALID_BACKTEST_CANDLE");
  });
});
