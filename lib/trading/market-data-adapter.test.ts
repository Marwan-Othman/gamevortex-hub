import { describe, expect, it } from "vitest";
import { getMarketSnapshot } from "./market-data-adapter";
import type { ExchangeAdapter } from "./exchange-adapter";

const adapter = (overrides: Partial<ExchangeAdapter["capabilities"]> = {}): ExchangeAdapter => ({
  id: "test-market-data",
  mode: "MARKET_DATA",
  capabilities: {
    marketData: true,
    paperTrading: true,
    liveOrders: false,
    withdrawals: false,
    margin: false,
    leverage: false,
    shortSelling: false,
    derivatives: false,
    ...overrides,
  },
  getMarketData: async () => ({
    symbol: "BTC-USD",
    interval: "1m",
    candles: [
      { timestamp: "2026-10-02T08:00:00.000Z", open: 100, high: 102, low: 99, close: 101, volume: 1000 },
      { timestamp: "2026-10-02T08:01:00.000Z", open: 101, high: 104, low: 100, close: 103, volume: 1200 },
    ],
  }),
});

describe("market-data-adapter", () => {
  it("connects adapter OHLCV data to the normalized snapshot", async () => {
    const snapshot = await getMarketSnapshot(adapter(), {
      symbol: "btc-usd",
      interval: "1m",
      limit: 2,
    });

    expect(snapshot.symbol).toBe("BTC-USD");
    expect(snapshot.price).toBe(103);
    expect(snapshot.previousPrice).toBe(101);
    expect(snapshot.candles).toHaveLength(2);
  });

  it("rejects an adapter without market-data capability", async () => {
    await expect(
      getMarketSnapshot(adapter({ marketData: false }), {
        symbol: "BTC-USD",
        interval: "1m",
        limit: 2,
      }),
    ).rejects.toThrow("MARKET_DATA_NOT_SUPPORTED");
  });

  it("rejects a provider symbol mismatch", async () => {
    const badAdapter = {
      ...adapter(),
      getMarketData: async () => ({
        symbol: "ETH-USD",
        interval: "1m",
        candles: [
          { timestamp: "2026-10-02T08:00:00.000Z", open: 100, high: 102, low: 99, close: 101, volume: 1000 },
        ],
      }),
    } satisfies ExchangeAdapter;

    await expect(
      getMarketSnapshot(badAdapter, {
        symbol: "BTC-USD",
        interval: "1m",
        limit: 1,
      }),
    ).rejects.toThrow("MARKET_DATA_SYMBOL_MISMATCH");
  });

  it("rejects an excessive request limit", async () => {
    await expect(
      getMarketSnapshot(adapter(), {
        symbol: "BTC-USD",
        interval: "1m",
        limit: 1001,
      }),
    ).rejects.toThrow("INVALID_MARKET_DATA_LIMIT");
  });

  it("rejects a provider response that exceeds the requested limit", async () => {
    const oversizedAdapter = {
      ...adapter(),
      getMarketData: async () => ({
        symbol: "BTC-USD",
        interval: "1m",
        candles: [
          { timestamp: "2026-10-02T08:00:00.000Z", open: 100, high: 102, low: 99, close: 101, volume: 1000 },
          { timestamp: "2026-10-02T08:01:00.000Z", open: 101, high: 104, low: 100, close: 103, volume: 1200 },
        ],
      }),
    } satisfies ExchangeAdapter;

    await expect(
      getMarketSnapshot(oversizedAdapter, {
        symbol: "BTC-USD",
        interval: "1m",
        limit: 1,
      }),
    ).rejects.toThrow("MARKET_DATA_LIMIT_EXCEEDED");
  });
});
