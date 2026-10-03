import { generateKeyPairSync, verify as cryptoVerify } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { BinanceSpotLiveAdapter } from "@/lib/trading/binance-spot-live-adapter";

describe("BinanceSpotLiveAdapter Ed25519 integration", () => {
  it("signs a live BUY request with the configured Ed25519 private key", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();

    let capturedUrl = "";
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      capturedUrl = String(input);
      return new Response(
        JSON.stringify({
          symbol: "BTCUSDT",
          orderId: 123,
          clientOrderId: "gv-live-test-001",
          status: "FILLED",
          executedQty: "0.00001",
          cumulativeQuoteQty: "1.00000000",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const adapter = new BinanceSpotLiveAdapter({
      apiKey: "test-api-key",
      apiPrivateKeyPem: privateKeyPem,
      liveTradingEnabled: true,
      fetcher,
    });

    const result = await adapter.placeSpotBuy({
      clientOrderId: "gv-live-test-001",
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

    expect(signature).toBeTruthy();
    expect(result.accepted).toBe(true);
    expect(result.providerOrderId).toBe("123");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(capturedUrl).toContain("https://api.binance.com/api/v3/order?");

    const verified = cryptoVerify(
      null,
      Buffer.from(url.searchParams.toString(), "utf8"),
      publicKeyPem,
      Buffer.from(signature!, "base64"),
    );

    expect(verified).toBe(true);
  });
});
