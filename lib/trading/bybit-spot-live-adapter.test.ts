import { describe, expect, it } from "vitest";
import { BybitSpotLiveAdapter } from "./bybit-spot-live-adapter";

function response(body: unknown, ok = true): Response {
  return new Response(JSON.stringify(body), { status: ok ? 200 : 500, headers: { "content-type": "application/json" } });
}

describe("BybitSpotLiveAdapter", () => {
  it("rejects non-official endpoints", () => {
    expect(() => new BybitSpotLiveAdapter({ baseUrl: "https://evil.example" })).toThrow("BYBIT_LIVE_BASE_URL_MUST_BE_OFFICIAL");
  });

  it("fails closed when live trading is disabled", async () => {
    const adapter = new BybitSpotLiveAdapter({ apiKey: "key", apiSecret: "secret", liveTradingEnabled: false, fetcher: async () => response({ retCode: 0, result: {} }) });
    await expect(adapter.placeSpotBuy({ clientOrderId: "gv-test-1", symbol: "BTCUSDT", side: "BUY", amountUsd: 10, entryPrice: 100, stopLossPrice: 95, takeProfitPrice: 110 })).rejects.toThrow("LIVE_TRADING_DISABLED");
  });

  it("checks API permissions, account mode, and quote balance using read-only endpoints", async () => {
    const calls: string[] = [];
    const adapter = new BybitSpotLiveAdapter({ apiKey: "key", apiSecret: "secret", fetcher: async (url) => {
      const path = new URL(String(url)).pathname;
      calls.push(path);
      if (path === "/v5/user/query-api") return response({ retCode: 0, result: { apiKey: "key", readOnly: 0, permissions: { Spot: ["SpotTrade"], Wallet: [], ContractTrade: [], Options: [], Derivatives: [] } } });
      if (path === "/v5/account/info") return response({ retCode: 0, result: { unifiedMarginStatus: 5, marginMode: "REGULAR_MARGIN", spotHedgingStatus: "OFF" } });
      if (path === "/v5/account/wallet-balance") return response({ retCode: 0, result: { list: [{ accountType: "UNIFIED", coin: [{ coin: "USDT", walletBalance: "12.5", locked: "2", spotBorrow: "0" }] }] } });
      throw new Error("unexpected endpoint");
    } });
    await expect(adapter.getLiveReadiness()).resolves.toEqual({ accountMode: 5, marginMode: "REGULAR_MARGIN", quoteAsset: "USDT", quoteFreeBalance: 10.5, blockers: [] });
    expect(calls).toEqual(["/v5/user/query-api", "/v5/account/info", "/v5/account/wallet-balance"]);
  });

  it("rejects Bybit API keys with withdrawal/transfer permissions", async () => {
    const adapter = new BybitSpotLiveAdapter({ apiKey: "key", apiSecret: "secret", fetcher: async () => response({ retCode: 0, result: { apiKey: "key", readOnly: 0, permissions: { Spot: ["SpotTrade"], Wallet: ["Withdraw"], ContractTrade: [], Options: [], Derivatives: [] } } }) });
    await expect(adapter.getLiveReadiness()).rejects.toThrow("BYBIT_LIVE_WITHDRAW_OR_TRANSFER_PERMISSION_FORBIDDEN");
  });

  it("rejects Bybit accounts with outstanding Spot borrow", async () => {
    const adapter = new BybitSpotLiveAdapter({ apiKey: "key", apiSecret: "secret", fetcher: async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === "/v5/user/query-api") return response({ retCode: 0, result: { apiKey: "key", readOnly: 0, permissions: { Spot: ["SpotTrade"], Wallet: [], ContractTrade: [], Options: [], Derivatives: [] } } });
      if (path === "/v5/account/info") return response({ retCode: 0, result: { unifiedMarginStatus: 5, marginMode: "REGULAR_MARGIN" } });
      return response({ retCode: 0, result: { list: [{ accountType: "UNIFIED", coin: [{ coin: "USDT", walletBalance: "12.5", locked: "0", spotBorrow: "1" }] }] } });
    } });
    await expect(adapter.getLiveReadiness()).rejects.toThrow("BYBIT_LIVE_SPOT_BORROW_DETECTED");
  });
  it("reads strict Spot market rules from the public instruments endpoint", async () => {
    const adapter = new BybitSpotLiveAdapter({ fetcher: async (url) => {
      expect(String(url)).toContain("/v5/market/instruments-info?");
      return response({ retCode: 0, result: { list: [{
        symbol: "BTCUSDT", status: "Trading", baseCoin: "BTC", quoteCoin: "USDT",
        lotSizeFilter: { minOrderQty: "0.00001", maxOrderQty: "900", qtyStep: "0.00001", minOrderAmt: "5" },
        priceFilter: { tickSize: "0.01" },
      }] } });
    } });
    await expect(adapter.getSpotSymbolRules!("BTCUSDT")).resolves.toEqual({
      symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", minOrderQty: "0.00001",
      maxOrderQty: "900", qtyStep: "0.00001", minOrderAmount: "5", tickSize: "0.01",
    });
  });

  it("fails closed when Bybit market rules are missing or invalid", async () => {
    const missing = new BybitSpotLiveAdapter({ fetcher: async () => response({ retCode: 0, result: { list: [] } }) });
    await expect(missing.getSpotSymbolRules!("BTCUSDT")).rejects.toThrow("BYBIT_LIVE_SYMBOL_RULES_MISSING");
    const invalid = new BybitSpotLiveAdapter({ fetcher: async () => response({ retCode: 0, result: { list: [{
      symbol: "BTCUSDT", status: "Trading", baseCoin: "BTC", quoteCoin: "USDT",
      lotSizeFilter: { minOrderQty: "0", maxOrderQty: "900", qtyStep: "0.00001", minOrderAmt: "5" },
      priceFilter: { tickSize: "0.01" },
    }] } }) });
    await expect(invalid.getSpotSymbolRules!("BTCUSDT")).rejects.toThrow("BYBIT_LIVE_SYMBOL_RULES_INVALID");
  });

  it("rejects instruments that are not actively trading", async () => {
    const adapter = new BybitSpotLiveAdapter({ fetcher: async () => response({ retCode: 0, result: { list: [{
      symbol: "BTCUSDT", status: "Settled", baseCoin: "BTC", quoteCoin: "USDT",
      lotSizeFilter: { minOrderQty: "0.00001", maxOrderQty: "900", qtyStep: "0.00001", minOrderAmt: "5" },
      priceFilter: { tickSize: "0.01" },
    }] } }) });
    await expect(adapter.getSpotSymbolRules!("BTCUSDT")).rejects.toThrow("BYBIT_LIVE_SYMBOL_RULES_INVALID");
  });

  it("rejects malformed quantity increments and zero tick sizes", async () => {
    const invalidQuantityStep = new BybitSpotLiveAdapter({ fetcher: async () => response({ retCode: 0, result: { list: [{
      symbol: "BTCUSDT", status: "Trading", baseCoin: "BTC", quoteCoin: "USDT",
      lotSizeFilter: { minOrderQty: "0.00001", maxOrderQty: "900", qtyStep: "0", minOrderAmt: "5" },
      priceFilter: { tickSize: "0.01" },
    }] } }) });
    await expect(invalidQuantityStep.getSpotSymbolRules!("BTCUSDT")).rejects.toThrow("BYBIT_LIVE_SYMBOL_RULES_INVALID");

    const invalidTickSize = new BybitSpotLiveAdapter({ fetcher: async () => response({ retCode: 0, result: { list: [{
      symbol: "BTCUSDT", status: "Trading", baseCoin: "BTC", quoteCoin: "USDT",
      lotSizeFilter: { minOrderQty: "0.00001", maxOrderQty: "900", qtyStep: "0.00001", minOrderAmt: "5" },
      priceFilter: { tickSize: "0" },
    }] } }) });
    await expect(invalidTickSize.getSpotSymbolRules!("BTCUSDT")).rejects.toThrow("BYBIT_LIVE_SYMBOL_RULES_INVALID");
  });

  it("fails closed on public instrument endpoint network errors", async () => {
    const adapter = new BybitSpotLiveAdapter({ fetcher: async () => { throw new Error("network details should not leak"); } });
    await expect(adapter.getSpotSymbolRules!("BTCUSDT")).rejects.toThrow("BYBIT_LIVE_SYMBOL_RULES_NETWORK_ERROR");
  });

  it("does not submit independent full-size Bybit exit legs as if they were an atomic OCO", async () => {
    let requests = 0;
    const adapter = new BybitSpotLiveAdapter({
      apiKey: "key",
      apiSecret: "secret",
      liveTradingEnabled: true,
      fetcher: async () => {
        requests += 1;
        return response({ retCode: 0, result: { orderId: "unexpected" } });
      },
    });

    await expect(adapter.placeProtectedExitOco!({
      symbol: "BTCUSDT",
      quantity: "0.01",
      entryPrice: "100",
      takeProfitClientOrderId: "gv-exit-tp-test",
      takeProfitPrice: "110",
      stopLossClientOrderId: "gv-exit-sl-test",
      stopLossPrice: "95",
      stopLimitPrice: "94.9",
    })).rejects.toThrow("BYBIT_NATIVE_LINKED_PROTECTION_NOT_IMPLEMENTED");
    expect(requests).toBe(0);
  });

  it("rejects a Bybit exit-status response for the wrong side", async () => {
    const adapter = new BybitSpotLiveAdapter({ apiKey: "key", apiSecret: "secret", liveTradingEnabled: true, fetcher: async () => response({ retCode: 0, result: { list: [{
      orderId: "12345678", orderLinkId: "gv-exit-sl-test", symbol: "BTCUSDT", side: "Buy", orderStatus: "Filled", cumExecQty: "0.01", cumExecValue: "1", updatedTime: "1700000000000",
    }] } }) });
    await expect(adapter.getProtectedExitLegStatus!({ symbol: "BTCUSDT", clientOrderId: "gv-exit-sl-test" })).rejects.toThrow("BYBIT_LIVE_EXIT_SIDE_MISMATCH");
  });

  it("rejects a Bybit exit-status response for a different symbol", async () => {
    const adapter = new BybitSpotLiveAdapter({ apiKey: "key", apiSecret: "secret", liveTradingEnabled: true, fetcher: async () => response({ retCode: 0, result: { list: [{
      orderId: "12345678", orderLinkId: "gv-exit-sl-test", symbol: "ETHUSDT", side: "Sell", orderStatus: "Filled", cumExecQty: "0.01", cumExecValue: "1", updatedTime: "1700000000000",
    }] } }) });
    await expect(adapter.getProtectedExitLegStatus!({ symbol: "BTCUSDT", clientOrderId: "gv-exit-sl-test" })).rejects.toThrow("BYBIT_LIVE_EXIT_SYMBOL_MISMATCH");
  });

  it("rejects a Bybit exit-status response for a different client order id", async () => {
    const adapter = new BybitSpotLiveAdapter({ apiKey: "key", apiSecret: "secret", liveTradingEnabled: true, fetcher: async () => response({ retCode: 0, result: { list: [{
      orderId: "12345678", orderLinkId: "gv-another-exit", symbol: "BTCUSDT", side: "Sell", orderStatus: "Filled", cumExecQty: "0.01", cumExecValue: "1", updatedTime: "1700000000000",
    }] } }) });
    await expect(adapter.getProtectedExitLegStatus!({ symbol: "BTCUSDT", clientOrderId: "gv-exit-sl-test" })).rejects.toThrow("BYBIT_LIVE_EXIT_CLIENT_ORDER_ID_MISMATCH");
  });

  it("normalizes reverse-ordered Bybit klines", async () => {
    const adapter = new BybitSpotLiveAdapter({ fetcher: async (url) => {
      expect(String(url)).toContain("/v5/market/kline?");
      return response({ retCode: 0, result: { list: [["2000", "2", "3", "1", "2.5", "4"], ["1000", "1", "2", "0.5", "1.5", "3"]] } });
    } });
    const result = await adapter.getMarketData({ symbol: "BTCUSDT", interval: "1", limit: 2 });
    expect(result.symbol).toBe("BTCUSDT");
    expect(result.candles.map((candle) => candle.close)).toEqual([1.5, 2.5]);
  });

  it("signs and submits a quote-sized Spot market buy", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const adapter = new BybitSpotLiveAdapter({ apiKey: "key", apiSecret: "secret", liveTradingEnabled: true, fetcher: async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return response({ retCode: 0, result: { orderId: "bybit-order-1", orderLinkId: "gv-test-1" } });
    } });
    const result = await adapter.placeSpotBuy({ clientOrderId: "gv-test-1", symbol: "BTCUSDT", side: "BUY", amountUsd: 10, entryPrice: 100, stopLossPrice: 95, takeProfitPrice: 110 });
    expect(result).toMatchObject({ accepted: true, providerOrderId: "bybit-order-1", clientOrderId: "gv-test-1", status: "SUBMITTED" });
    expect(capturedUrl).toBe("https://api.bybit.com/v5/order/create");
    expect(capturedInit?.method).toBe("POST");
    expect(capturedInit?.headers).toMatchObject({ "X-BAPI-API-KEY": "key", "X-BAPI-SIGN": expect.any(String) });
    expect(JSON.parse(String(capturedInit?.body))).toMatchObject({ category: "spot", side: "Buy", orderType: "Market", qty: "10.00000000", marketUnit: "quoteCoin", orderLinkId: "gv-test-1", isLeverage: 0 });
  });

  it("rejects an order-status response for a different symbol", async () => {
    const adapter = new BybitSpotLiveAdapter({ apiKey: "key", apiSecret: "secret", liveTradingEnabled: true, fetcher: async () => response({ retCode: 0, result: { list: [{
      orderId: "bybit-order-1", orderLinkId: "gv-test-1", symbol: "ETHUSDT", side: "Buy", orderStatus: "Filled", avgPrice: "100.5", cumExecQty: "0.1", cumExecValue: "10.05", updatedTime: "1700000000000",
    }] } }) });
    await expect(adapter.getOrderStatus({ symbol: "BTCUSDT", clientOrderId: "gv-test-1" })).rejects.toThrow("BYBIT_LIVE_ORDER_SYMBOL_MISMATCH");
  });

  it("rejects an order-status response for a different client order id", async () => {
    const adapter = new BybitSpotLiveAdapter({ apiKey: "key", apiSecret: "secret", liveTradingEnabled: true, fetcher: async () => response({ retCode: 0, result: { list: [{
      orderId: "bybit-order-1", orderLinkId: "gv-other-order", symbol: "BTCUSDT", side: "Buy", orderStatus: "Filled", avgPrice: "100.5", cumExecQty: "0.1", cumExecValue: "10.05", updatedTime: "1700000000000",
    }] } }) });
    await expect(adapter.getOrderStatus({ symbol: "BTCUSDT", clientOrderId: "gv-test-1" })).rejects.toThrow("BYBIT_LIVE_ORDER_CLIENT_ID_MISMATCH");
  });

  it("rejects a BUY submission response with a mismatched client order id", async () => {
    const adapter = new BybitSpotLiveAdapter({ apiKey: "key", apiSecret: "secret", liveTradingEnabled: true, fetcher: async () => response({ retCode: 0, result: { orderId: "bybit-order-1", orderLinkId: "gv-other-order" } }) });
    await expect(adapter.placeSpotBuy({ clientOrderId: "gv-test-1", symbol: "BTCUSDT", side: "BUY", amountUsd: 10, entryPrice: 100, stopLossPrice: 95, takeProfitPrice: 110 })).rejects.toThrow("BYBIT_LIVE_CLIENT_ORDER_ID_MISMATCH");
  });

  it("rejects Bybit execution fills for a different order or symbol", async () => {
    for (const mismatch of [
      { symbol: "ETHUSDT", orderId: "bybit-order-1", error: "BYBIT_LIVE_TRADE_FILL_SYMBOL_MISMATCH" },
      { symbol: "BTCUSDT", orderId: "another-order", error: "BYBIT_LIVE_TRADE_FILL_ORDER_ID_MISMATCH" },
    ]) {
      const adapter = new BybitSpotLiveAdapter({ apiKey: "key", apiSecret: "secret", liveTradingEnabled: true, fetcher: async (url) => {
        if (String(url).includes("/v5/market/instruments-info?")) return response({ retCode: 0, result: { list: [{ symbol: "BTCUSDT", baseCoin: "BTC", quoteCoin: "USDT" }] } });
        return response({ retCode: 0, result: { list: [{ execId: "fill-1", symbol: mismatch.symbol, orderId: mismatch.orderId, side: "Buy", execQty: "0.1", execValue: "10", execFee: "0.01", feeCurrency: "USDT" }] } });
      } });
      await expect(adapter.getOrderTradeFills({ symbol: "BTCUSDT", providerOrderId: "bybit-order-1" })).rejects.toThrow(mismatch.error);
    }
  });

  it("rejects Bybit fill metadata when the instrument identity or execution id is missing", async () => {
    const makeAdapter = (instrument: Record<string, unknown>, fill: Record<string, unknown>) => new BybitSpotLiveAdapter({
      apiKey: "key", apiSecret: "secret", liveTradingEnabled: true, fetcher: async (url) => {
        if (String(url).includes("/v5/market/instruments-info?")) return response({ retCode: 0, result: { list: [instrument] } });
        return response({ retCode: 0, result: { list: [fill] } });
      },
    });
    const validFill = { symbol: "BTCUSDT", orderId: "bybit-order-1", side: "Buy", execId: "fill-1", execQty: "0.1", execValue: "10", execFee: "0.01", feeCurrency: "USDT" };
    await expect(makeAdapter({ symbol: "ETHUSDT", baseCoin: "ETH", quoteCoin: "USDT" }, validFill).getOrderTradeFills({ symbol: "BTCUSDT", providerOrderId: "bybit-order-1" })).rejects.toThrow("BYBIT_LIVE_SYMBOL_ASSET_INFO_REQUIRED");
    const { execId: _omitted, ...withoutId } = validFill;
    await expect(makeAdapter({ symbol: "BTCUSDT", baseCoin: "BTC", quoteCoin: "USDT" }, withoutId).getOrderTradeFills({ symbol: "BTCUSDT", providerOrderId: "bybit-order-1" })).rejects.toThrow("BYBIT_LIVE_TRADE_FILL_ID_REQUIRED");
  });

  it("rejects incomplete, duplicate, or paginated Bybit execution history", async () => {
    const makeAdapter = (result: Record<string, unknown>) => new BybitSpotLiveAdapter({
      apiKey: "key", apiSecret: "secret", liveTradingEnabled: true, fetcher: async (url) => {
        if (String(url).includes("/v5/market/instruments-info?")) return response({ retCode: 0, result: { list: [{ symbol: "BTCUSDT", baseCoin: "BTC", quoteCoin: "USDT" }] } });
        return response({ retCode: 0, result });
      },
    });
    const fill = { execId: "fill-1", symbol: "BTCUSDT", orderId: "bybit-order-1", side: "Buy", execQty: "0.1", execValue: "10", execFee: "0.01", feeCurrency: "USDT" };
    await expect(makeAdapter({ list: [{ ...fill, side: "Unknown" }] }).getOrderTradeFills({ symbol: "BTCUSDT", providerOrderId: "bybit-order-1" })).rejects.toThrow("BYBIT_LIVE_TRADE_FILL_SIDE_INVALID");
    await expect(makeAdapter({ list: [fill, fill] }).getOrderTradeFills({ symbol: "BTCUSDT", providerOrderId: "bybit-order-1" })).rejects.toThrow("BYBIT_LIVE_TRADE_FILL_ID_DUPLICATE");
    await expect(makeAdapter({ list: [fill], nextPageCursor: "more-results" }).getOrderTradeFills({ symbol: "BTCUSDT", providerOrderId: "bybit-order-1" })).rejects.toThrow("BYBIT_LIVE_TRADE_FILLS_PAGINATION_REQUIRED");
  });

  it("reconciles a filled order by orderLinkId", async () => {
    const adapter = new BybitSpotLiveAdapter({ apiKey: "key", apiSecret: "secret", liveTradingEnabled: true, fetcher: async () => response({ retCode: 0, result: { list: [{ orderId: "bybit-order-1", orderLinkId: "gv-test-1", symbol: "BTCUSDT", side: "Buy", orderStatus: "Filled", avgPrice: "100.5", cumExecQty: "0.1", cumExecValue: "10.05", updatedTime: "1700000000000" }] } }) });
    const result = await adapter.getOrderStatus({ symbol: "BTCUSDT", clientOrderId: "gv-test-1" });
    expect(result.observation).toMatchObject({ clientOrderId: "gv-test-1", providerOrderId: "bybit-order-1", symbol: "BTCUSDT", side: "BUY", status: "FILLED", executedQty: 0.1, cumulativeQuoteQty: 10.05, averageFillPrice: 100.5 });
  });
});
