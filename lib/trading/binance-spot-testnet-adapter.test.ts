import { describe, expect, it, vi } from "vitest";
import { BinanceSpotTestnetAdapter } from "@/lib/trading/binance-spot-testnet-adapter";

function response(body: unknown, ok = true, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("BinanceSpotTestnetAdapter", () => {
  it("uses the official Spot Testnet host and normalizes slash-separated symbols", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response([
        [
          1760000000000,
          "100",
          "101",
          "99",
          "100.5",
          "1200",
          1760000059999,
          "120600",
          100,
          "600",
          "60300",
          "0",
        ],
      ]),
    );

    const adapter = new BinanceSpotTestnetAdapter({ fetcher });
    const result = await adapter.getMarketData({ symbol: "BTC/USDT", interval: "1m", limit: 1 });

    expect(fetcher).toHaveBeenCalledWith(
      "https://testnet.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=1",
      expect.objectContaining({ method: "GET" }),
    );
    expect(result.symbol).toBe("BTCUSDT");
    expect(result.candles[0]).toMatchObject({
      open: 100,
      high: 101,
      low: 99,
      close: 100.5,
      volume: 1200,
    });
  });

  it("rejects any non-official testnet host", () => {
    expect(() => new BinanceSpotTestnetAdapter({ baseUrl: "https://api.binance.com" })).toThrow(
      "BINANCE_TESTNET_BASE_URL_MUST_BE_OFFICIAL_TESTNET",
    );
  });

  it("never places an order without server-side credentials", async () => {
    const adapter = new BinanceSpotTestnetAdapter({ fetcher: vi.fn<typeof fetch>() });

    await expect(
      adapter.placeSpotBuy({
        clientOrderId: "paper-test-1",
        symbol: "BTC/USDT",
        side: "BUY",
        amountUsd: 1,
        entryPrice: 100,
        stopLossPrice: 98,
        takeProfitPrice: 104,
      }),
    ).rejects.toThrow("BINANCE_TESTNET_API_CREDENTIALS_REQUIRED");
  });

  it("signs and submits a testnet market BUY without enabling live-order capability", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response({
        symbol: "BTCUSDT",
        orderId: 12345,
        clientOrderId: "test-order-1",
        status: "FILLED",
      }),
    );

    const adapter = new BinanceSpotTestnetAdapter({
      apiKey: "test-key",
      apiSecret: "test-secret",
      fetcher,
    });

    const result = await adapter.placeSpotBuy({
      clientOrderId: "test-order-1",
      symbol: "BTC/USDT",
      side: "BUY",
      amountUsd: 1,
      entryPrice: 100,
      stopLossPrice: 98,
      takeProfitPrice: 104,
    });

    expect(result).toEqual({
      accepted: true,
      clientOrderId: "test-order-1",
      providerOrderId: "12345",
      status: "FILLED",
    });
    expect(adapter.capabilities.liveOrders).toBe(false);

    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toMatch(/^https:\/\/testnet\.binance\.vision\/api\/v3\/order\?/);
    expect(url).toContain("symbol=BTCUSDT");
    expect(url).toContain("side=BUY");
    expect(url).toContain("type=MARKET");
    expect(url).toContain("quoteOrderQty=1.00000000");
    expect(url).toContain("newClientOrderId=test-order-1");
    expect(url).toContain("signature=");
    expect(init).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({ "X-MBX-APIKEY": "test-key" }),
    });
  });

  it("fails closed when the provider rejects the request", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      response({ msg: "Invalid API-key, IP, or permissions for action." }, false, 401),
    );

    const adapter = new BinanceSpotTestnetAdapter({
      apiKey: "test-key",
      apiSecret: "test-secret",
      fetcher,
    });

    await expect(
      adapter.placeSpotBuy({
        clientOrderId: "test-order-2",
        symbol: "BTC/USDT",
        side: "BUY",
        amountUsd: 1,
        entryPrice: 100,
        stopLossPrice: 98,
      }),
    ).rejects.toThrow("BINANCE_TESTNET_Invalid API-key, IP, or permissions for action.");
  });
});
