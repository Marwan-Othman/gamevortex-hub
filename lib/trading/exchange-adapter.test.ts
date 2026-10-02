import { describe, expect, it } from "vitest";
import {
  assertLiveAdapterCapability,
  validateExchangeOrderRequest,
  type ExchangeAdapter,
  type ExchangeOrderRequest,
} from "./exchange-adapter";

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

const validOrder: ExchangeOrderRequest = {
  clientOrderId: "client-test-001",
  symbol: "BTCUSD",
  side: "BUY",
  amountUsd: 10,
  entryPrice: 100,
  stopLossPrice: 98,
  takeProfitPrice: 104,
};

describe("assertLiveAdapterCapability", () => {
  it("accepts a strictly constrained spot adapter", () => {
    expect(() => assertLiveAdapterCapability(liveAdapter())).not.toThrow();
  });

  it("rejects a non-live adapter", () => {
    const adapter = liveAdapter();
    expect(() => assertLiveAdapterCapability({ ...adapter, mode: "PAPER" })).toThrow(
      "LIVE_ADAPTER_REQUIRED",
    );
  });

  it("rejects withdrawals", () => {
    expect(() => assertLiveAdapterCapability(liveAdapter({ withdrawals: true }))).toThrow("WITHDRAWALS_FORBIDDEN");
  });

  it("rejects leverage and derivatives", () => {
    expect(() => assertLiveAdapterCapability(liveAdapter({ leverage: true }))).toThrow("LEVERAGE_FORBIDDEN");
    expect(() => assertLiveAdapterCapability(liveAdapter({ derivatives: true }))).toThrow("DERIVATIVES_FORBIDDEN");
  });

  it("rejects margin trading", () => {
    expect(() => assertLiveAdapterCapability(liveAdapter({ margin: true }))).toThrow("MARGIN_FORBIDDEN");
  });

  it("rejects short selling", () => {
    expect(() => assertLiveAdapterCapability(liveAdapter({ shortSelling: true }))).toThrow("SHORT_SELLING_FORBIDDEN");
  });

  it("rejects adapters without live order capability", () => {
    expect(() => assertLiveAdapterCapability(liveAdapter({ liveOrders: false }))).toThrow("LIVE_ORDERS_NOT_SUPPORTED");
  });

  it("rejects adapters without market data capability", () => {
    expect(() => assertLiveAdapterCapability(liveAdapter({ marketData: false }))).toThrow("MARKET_DATA_NOT_SUPPORTED");
  });

  it("rejects adapters without paper trading capability", () => {
    expect(() => assertLiveAdapterCapability(liveAdapter({ paperTrading: false }))).toThrow("PAPER_TRADING_NOT_SUPPORTED");
  });

  it("rejects adapters without a spot BUY implementation", () => {
    const adapter = liveAdapter();
    expect(() => assertLiveAdapterCapability({ ...adapter, placeSpotBuy: undefined })).toThrow(
      "SPOT_BUY_ADAPTER_REQUIRED",
    );
  });
});

describe("validateExchangeOrderRequest", () => {
  it("accepts a valid $1+ spot BUY with protective levels", () => {
    expect(() => validateExchangeOrderRequest({ ...validOrder, amountUsd: 1 })).not.toThrow();
  });

  it("rejects orders below the $1 minimum", () => {
    expect(() => validateExchangeOrderRequest({ ...validOrder, amountUsd: 0.99 })).toThrow(
      "INVALID_ORDER_AMOUNT",
    );
  });

  it("rejects invalid client order identifiers", () => {
    expect(() => validateExchangeOrderRequest({ ...validOrder, clientOrderId: "   " })).toThrow(
      "INVALID_CLIENT_ORDER_ID",
    );
  });

  it("rejects malformed symbols", () => {
    expect(() => validateExchangeOrderRequest({ ...validOrder, symbol: "BTC USD" })).toThrow(
      "INVALID_ORDER_SYMBOL",
    );
  });

  it("rejects a BUY stop-loss at or above entry", () => {
    expect(() => validateExchangeOrderRequest({ ...validOrder, stopLossPrice: 100 })).toThrow(
      "INVALID_ORDER_STOP_LOSS_FOR_BUY",
    );
  });

  it("rejects a BUY take-profit at or below entry", () => {
    expect(() => validateExchangeOrderRequest({ ...validOrder, takeProfitPrice: 100 })).toThrow(
      "INVALID_ORDER_TAKE_PROFIT_FOR_BUY",
    );
  });
});
