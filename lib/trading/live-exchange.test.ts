import { generateKeyPairSync, verify as cryptoVerify } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBinanceSpotLiveAdapter, createLiveExchangeAdapter, getConfiguredLiveExchange } from "./live-exchange";

describe("live exchange selection", () => {
  it("defaults to Binance for backward compatibility", () => {
    expect(getConfiguredLiveExchange(undefined)).toBe("BINANCE");
  });

  it("accepts Binance and Bybit only", () => {
    expect(getConfiguredLiveExchange("binance")).toBe("BINANCE");
    expect(getConfiguredLiveExchange("BYBIT")).toBe("BYBIT");
    expect(() => getConfiguredLiveExchange("KRAKEN")).toThrow("INVALID_LIVE_EXCHANGE");
  });

  it("creates the requested provider adapter without contacting the network", () => {
    expect(createLiveExchangeAdapter({ fetcher: async () => new Response() }).id).toBe("binance-spot-live");
    const previous = process.env.GAMEVORTEX_LIVE_EXCHANGE;
    process.env.GAMEVORTEX_LIVE_EXCHANGE = "BYBIT";
    try {
      expect(createLiveExchangeAdapter({ fetcher: async () => new Response() }).id).toBe("bybit-spot-live");
    } finally {
      if (previous === undefined) delete process.env.GAMEVORTEX_LIVE_EXCHANGE;
      else process.env.GAMEVORTEX_LIVE_EXCHANGE = previous;
    }
  });
});


const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe("centralized Binance credential wiring", () => {
  it("uses the configured Ed25519 private key for signed settlement-fill lookups", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();

    process.env.BINANCE_LIVE_API_KEY = "test-api-key";
    process.env.BINANCE_LIVE_API_PRIVATE_KEY = privateKeyPem;
    delete process.env.BINANCE_LIVE_API_SECRET;
    process.env.GAMEVORTEX_LIVE_TRADING_ENABLED = "true";

    let signedUrl = "";
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/api/v3/exchangeInfo?")) {
        return new Response(
          JSON.stringify({
            symbols: [{ symbol: "BTCUSDT", status: "TRADING", baseAsset: "BTC", quoteAsset: "USDT" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }

      signedUrl = url;
      return new Response(
        JSON.stringify([
          {
            symbol: "BTCUSDT",
            id: 456,
            orderId: 123,
            price: "100000.00",
            qty: "0.00001",
            quoteQty: "1.00000000",
            commission: "0.000001",
            commissionAsset: "BTC",
            time: 1770000000000,
            isBuyer: true,
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const adapter = createBinanceSpotLiveAdapter({ fetcher });
    const result = await adapter.getOrderTradeFills({ symbol: "BTCUSDT", providerOrderId: "123" });

    const url = new URL(signedUrl);
    const signature = url.searchParams.get("signature");
    url.searchParams.delete("signature");

    expect(result.fills).toHaveLength(1);
    expect(signature).toBeTruthy();
    expect(
      cryptoVerify(
        null,
        Buffer.from(url.searchParams.toString(), "utf8"),
        publicKeyPem,
        Buffer.from(signature!, "base64"),
      ),
    ).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("blocks signed exchange requests while live execution is disabled", async () => {
    process.env.BINANCE_LIVE_API_KEY = "test-api-key";
    process.env.BINANCE_LIVE_API_SECRET = "test-secret";
    process.env.GAMEVORTEX_LIVE_TRADING_ENABLED = "false";

    const fetcher = vi.fn<typeof fetch>();
    const adapter = createBinanceSpotLiveAdapter({ fetcher });

    await expect(adapter.getOrderTradeFills({ symbol: "BTCUSDT", providerOrderId: "123" })).rejects.toThrow(
      "LIVE_TRADING_DISABLED",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});
