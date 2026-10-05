import { describe, expect, it } from "vitest";
import { createLiveExchangeAdapter, getConfiguredLiveExchange } from "./live-exchange";

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
