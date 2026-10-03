import { describe, expect, it, vi } from "vitest";
import {
  assertBinanceLiveBuyRules,
  assertBinanceLiveProtectedExitRules,
  getBinanceLiveSymbolRules,
} from "@/lib/trading/binance-live-symbol-rules";

function exchangeInfo() {
  return {
    symbols: [
      {
        symbol: "BTCUSDT",
        status: "TRADING",
        baseAsset: "BTC",
        quoteAsset: "USDT",
        filters: [
          { filterType: "PRICE_FILTER", minPrice: "0.01000000", maxPrice: "1000000.00000000", tickSize: "0.01000000" },
          { filterType: "LOT_SIZE", minQty: "0.00001000", maxQty: "9000.00000000", stepSize: "0.00001000" },
          { filterType: "MIN_NOTIONAL", minNotional: "5.00000000", applyToMarket: true },
        ],
      },
    ],
  };
}

describe("Binance live symbol rules", () => {
  it("reads current symbol rules without private credentials", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(exchangeInfo()), { status: 200 }));

    const result = await getBinanceLiveSymbolRules("BTC/USDT", fetcher);

    expect(result.symbol).toBe("BTCUSDT");
    expect(result.quoteAsset).toBe("USDT");
    expect(result.minNotional).toBe(5);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("blocks an application-level $1 order when Binance requires a higher notional", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(exchangeInfo()), { status: 200 }));

    await expect(
      assertBinanceLiveBuyRules({ symbol: "BTCUSDT", amountUsd: 1, entryPrice: 100_000, fetcher }),
    ).rejects.toThrow("BINANCE_LIVE_MIN_NOTIONAL:5");
  });

  it("accepts a valid notional and protected exit that satisfy the exchange filters", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(exchangeInfo()), { status: 200 }));

    await expect(
      assertBinanceLiveBuyRules({ symbol: "BTCUSDT", amountUsd: 10, entryPrice: 100_000, fetcher }),
    ).resolves.toMatchObject({ symbol: "BTCUSDT", minNotional: 5 });

    await expect(
      assertBinanceLiveProtectedExitRules({
        symbol: "BTCUSDT",
        quantity: 0.0001,
        takeProfitPrice: 101_000,
        stopLossPrice: 99_000,
        stopLimitPrice: 98_990,
        fetcher,
      }),
    ).resolves.toMatchObject({ symbol: "BTCUSDT" });
  });
});
