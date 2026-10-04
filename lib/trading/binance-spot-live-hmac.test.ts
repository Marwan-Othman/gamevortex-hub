import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { BinanceSpotLiveAdapter } from "@/lib/trading/binance-spot-live-adapter";

describe("BinanceSpotLiveAdapter HMAC integration", () => {
  it("signs a live BUY request with the configured HMAC secret", async () => {
    let capturedUrl = "";
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify({
        symbol: "BTCUSDT",
        orderId: 123,
        clientOrderId: "gv-live-hmac-001",
        status: "FILLED",
        executedQty: "0.00001",
        cumulativeQuoteQty: "1.00000000",
      }), { status: 200 });
    });

    const adapter = new BinanceSpotLiveAdapter({
      apiKey: "test-api-key",
      apiSecret: "test-secret",
      liveTradingEnabled: true,
      fetcher,
    });

    await adapter.placeSpotBuy({
      clientOrderId: "gv-live-hmac-001",
      symbol: "BTCUSDT",
      side: "BUY",
      amountUsd: 1,
      entryPrice: 100_000,
      stopLossPrice: 99_000,
      takeProfitPrice: 102_000,
    });

    const url = new URL(capturedUrl);
    const signature = url.searchParams.get("signature");
    url.searchParams.delete("signature");
    const expected = createHmac("sha256", "test-secret")
      .update(url.searchParams.toString(), "utf8")
      .digest("hex");

    expect(signature).toBe(expected);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
