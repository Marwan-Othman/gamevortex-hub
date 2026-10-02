import { describe, expect, it } from "vitest";
import { assertLiveAdapterCapability, type ExchangeAdapter } from "./exchange-adapter";

const liveAdapter = (overrides: Partial<ExchangeAdapter["capabilities"]> = {}): ExchangeAdapter => ({
  id: "test-live",
  mode: "LIVE",
  capabilities: {
    marketData: true,
    paperTrading: true,
    liveOrders: true,
    withdrawals: false,
    margin: false,
    leverage: false,
    shortSelling: false,
    derivatives: false,
    ...overrides,
  },
  getMarketData: async () => ({
    symbol: "TEST",
    interval: "1m",
    candles: [],
  }),
  placeSpotBuy: async (request) => ({
    accepted: true,
    clientOrderId: request.clientOrderId,
    status: "FILLED",
  }),
});

describe("assertLiveAdapterCapability", () => {
  it("accepts a strictly constrained spot adapter", () => {
    expect(() => assertLiveAdapterCapability(liveAdapter())).not.toThrow();
  });

  it("rejects withdrawals", () => {
    expect(() => assertLiveAdapterCapability(liveAdapter({ withdrawals: true }))).toThrow("WITHDRAWALS_FORBIDDEN");
  });

  it("rejects leverage and derivatives", () => {
    expect(() => assertLiveAdapterCapability(liveAdapter({ leverage: true }))).toThrow("LEVERAGE_FORBIDDEN");
    expect(() => assertLiveAdapterCapability(liveAdapter({ derivatives: true }))).toThrow("DERIVATIVES_FORBIDDEN");
  });

  it("rejects adapters without live order capability", () => {
    expect(() => assertLiveAdapterCapability(liveAdapter({ liveOrders: false }))).toThrow("LIVE_ORDERS_NOT_SUPPORTED");
  });
});
