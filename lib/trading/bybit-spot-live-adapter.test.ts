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

  it("reconciles a filled order by orderLinkId", async () => {
    const adapter = new BybitSpotLiveAdapter({ apiKey: "key", apiSecret: "secret", liveTradingEnabled: true, fetcher: async () => response({ retCode: 0, result: { list: [{ orderId: "bybit-order-1", orderLinkId: "gv-test-1", symbol: "BTCUSDT", side: "Buy", orderStatus: "Filled", avgPrice: "100.5", cumExecQty: "0.1", cumExecValue: "10.05", updatedTime: "1700000000000" }] } }) });
    const result = await adapter.getOrderStatus({ symbol: "BTCUSDT", clientOrderId: "gv-test-1" });
    expect(result.observation).toMatchObject({ clientOrderId: "gv-test-1", providerOrderId: "bybit-order-1", symbol: "BTCUSDT", side: "BUY", status: "FILLED", executedQty: 0.1, cumulativeQuoteQty: 10.05, averageFillPrice: 100.5 });
  });
});
