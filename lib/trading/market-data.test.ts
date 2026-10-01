import { describe, expect, it } from "vitest";
import {
  UnconfiguredMarketDataProvider,
  validateCandleLimit,
  validateMarketCandle,
  validateMarketQuote,
} from "./market-data";

describe("market data validation", () => {
  it("accepts a valid quote", () => {
    expect(() =>
      validateMarketQuote({
        symbol: "BTC-USD",
        bid: 100,
        ask: 101,
        last: 100.5,
        timestamp: new Date().toISOString(),
        source: "paper",
      }),
    ).not.toThrow();
  });

  it("rejects inverted spreads", () => {
    expect(() =>
      validateMarketQuote({
        symbol: "BTC-USD",
        bid: 101,
        ask: 100,
        last: 100.5,
        timestamp: new Date().toISOString(),
        source: "paper",
      }),
    ).toThrow("INVALID_MARKET_QUOTE_SPREAD");
  });

  it("accepts a valid OHLCV candle", () => {
    expect(() =>
      validateMarketCandle({
        timestamp: new Date().toISOString(),
        open: 100,
        high: 110,
        low: 90,
        close: 105,
        volume: 1000,
      }),
    ).not.toThrow();
  });

  it("rejects an invalid candle range", () => {
    expect(() =>
      validateMarketCandle({
        timestamp: new Date().toISOString(),
        open: 100,
        high: 99,
        low: 90,
        close: 105,
        volume: 1000,
      }),
    ).toThrow("INVALID_MARKET_CANDLE_HIGH");
  });

  it("bounds historical candle requests", () => {
    expect(validateCandleLimit(100)).toBe(100);
    expect(() => validateCandleLimit(0)).toThrow("INVALID_MARKET_CANDLE_LIMIT");
    expect(() => validateCandleLimit(1001)).toThrow("INVALID_MARKET_CANDLE_LIMIT");
  });

  it("fails closed when no provider is configured", async () => {
    const provider = new UnconfiguredMarketDataProvider();
    await expect(provider.getQuote("BTC-USD")).rejects.toThrow("MARKET_DATA_NOT_CONFIGURED");
    await expect(provider.getCandles("BTC-USD", 100)).rejects.toThrow("MARKET_DATA_NOT_CONFIGURED");
  });
});
