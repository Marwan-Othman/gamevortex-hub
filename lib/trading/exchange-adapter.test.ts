import { describe, expect, it } from "vitest";
import {
  assertLiveAdapterCapability,
  validateExchangeAdapterContract,
  validateExchangeMarketDataRequest,
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
  getMarketData: async () => ({ symbol: "TEST", interval: "1m", candles: [] }),
  placeSpotBuy: async (request) => ({ accepted: true, clientOrderId: request.clientOrderId, status: "FILLED" }),
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

describe("validateExchangeAdapterContract", () => {
  it("accepts a coherent adapter contract", () => {
    expect(() => validateExchangeAdapterContract(liveAdapter())).not.toThrow();
  });

  it("rejects an empty adapter id", () => {
    expect(() => validateExchangeAdapterContract({ ...liveAdapter(), id: "   " })).toThrow("INVALID_EXCHANGE_ADAPTER_ID");
  });

  it("requires market data capability in MARKET_DATA mode", () => {
    const base = liveAdapter();
    const adapter = { ...base, mode: "MARKET_DATA" as const, capabilities: { ...base.capabilities, marketData: false } };
    expect(() => validateExchangeAdapterContract(adapter)).toThrow("MARKET_DATA_MODE_REQUIRES_MARKET_DATA");
  });

  it("requires paper capability in PAPER mode", () => {
    const base = liveAdapter();
    const adapter = { ...base, mode: "PAPER" as const, capabilities: { ...base.capabilities, paperTrading: false } };
    expect(() => validateExchangeAdapterContract(adapter)).toThrow("PAPER_MODE_REQUIRES_PAPER_TRADING");
  });
});

describe("validateExchangeMarketDataRequest", () => {
  it("accepts a valid bounded request", () => {
    expect(() => validateExchangeMarketDataRequest({ symbol: "BTCUSD", interval: "1m", limit: 100 })).not.toThrow();
  });

  it("rejects malformed symbols", () => {
    expect(() => validateExchangeMarketDataRequest({ symbol: "BTC USD", interval: "1m", limit: 100 })).toThrow("INVALID_MARKET_DATA_SYMBOL");
  });

  it("rejects an excessive limit", () => {
    expect(() => validateExchangeMarketDataRequest({ symbol: "BTCUSD", interval: "1m", limit: 1001 })).toThrow("INVALID_MARKET_DATA_LIMIT");
  });
});

describe("assertLiveAdapterCapability", () => {
  it("accepts a strictly constrained spot adapter", () => {
    expect(() => assertLiveAdapterCapability(liveAdapter())).not.toThrow();
  });

  it("rejects a non-live adapter", () => {
    expect(() => assertLiveAdapterCapability({ ...liveAdapter(), mode: "PAPER" })).toThrow("LIVE_ADAPTER_REQUIRED");
  });

  it("rejects forbidden capabilities", () => {
    expect(() => assertLiveAdapterCapability(liveAdapter({ withdrawals: true }))).toThrow("WITHDRAWALS_FORBIDDEN");
    expect(() => assertLiveAdapterCapability(liveAdapter({ margin: true }))).toThrow("MARGIN_FORBIDDEN");
    expect(() => assertLiveAdapterCapability(liveAdapter({ leverage: true }))).toThrow("LEVERAGE_FORBIDDEN");
    expect(() => assertLiveAdapterCapability(liveAdapter({ shortSelling: true }))).toThrow("SHORT_SELLING_FORBIDDEN");
    expect(() => assertLiveAdapterCapability(liveAdapter({ derivatives: true }))).toThrow("DERIVATIVES_FORBIDDEN");
  });

  it("rejects missing required capabilities", () => {
    expect(() => assertLiveAdapterCapability(liveAdapter({ liveOrders: false }))).toThrow("LIVE_ORDERS_NOT_SUPPORTED");
    expect(() => assertLiveAdapterCapability(liveAdapter({ marketData: false }))).toThrow("MARKET_DATA_NOT_SUPPORTED");
    expect(() => assertLiveAdapterCapability(liveAdapter({ paperTrading: false }))).toThrow("PAPER_TRADING_NOT_SUPPORTED");
    expect(() => assertLiveAdapterCapability({ ...liveAdapter(), placeSpotBuy: undefined })).toThrow("SPOT_BUY_ADAPTER_REQUIRED");
  });
});

describe("validateExchangeOrderRequest", () => {
  it("accepts a valid $1+ spot BUY with protective levels", () => {
    expect(() => validateExchangeOrderRequest({ ...validOrder, amountUsd: 1 })).not.toThrow();
  });

  it("rejects non-BUY runtime input", () => {
    expect(() => validateExchangeOrderRequest({ ...validOrder, side: "SELL" as never })).toThrow("SPOT_BUY_ONLY");
  });

  it("rejects invalid amount, client id, symbol and protective levels", () => {
    expect(() => validateExchangeOrderRequest({ ...validOrder, amountUsd: 0.99 })).toThrow("INVALID_ORDER_AMOUNT");
    expect(() => validateExchangeOrderRequest({ ...validOrder, clientOrderId: "   " })).toThrow("INVALID_CLIENT_ORDER_ID");
    expect(() => validateExchangeOrderRequest({ ...validOrder, symbol: "BTC USD" })).toThrow("INVALID_ORDER_SYMBOL");
    expect(() => validateExchangeOrderRequest({ ...validOrder, stopLossPrice: 100 })).toThrow("INVALID_ORDER_STOP_LOSS_FOR_BUY");
    expect(() => validateExchangeOrderRequest({ ...validOrder, takeProfitPrice: 100 })).toThrow("INVALID_ORDER_TAKE_PROFIT_FOR_BUY");
  });
});
