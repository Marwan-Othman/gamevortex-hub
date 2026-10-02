import { describe, expect, it, vi } from "vitest";
import { BinanceSpotLiveAdapter } from "@/lib/trading/binance-spot-live-adapter";

describe("BinanceSpotLiveAdapter safety boundary", () => {
  it("keeps live execution disabled unless explicitly enabled", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const adapter = new BinanceSpotLiveAdapter({ fetcher, liveTradingEnabled: false });

    await expect(
      adapter.placeSpotBuy({
        clientOrderId: "gv-live-test-001",
        symbol: "BTCUSDT",
        side: "BUY",
        amountUsd: 1,
        entryPrice: 100,
        stopLossPrice: 98,
        takeProfitPrice: 104,
      }),
    ).rejects.toThrow("LIVE_TRADING_DISABLED");

    await expect(adapter.getOrderStatus({ symbol: "BTCUSDT", clientOrderId: "gv-live-test-001" })).rejects.toThrow("LIVE_TRADING_DISABLED");

    await expect(
      adapter.placeProtectedExitOco({
        symbol: "BTCUSDT",
        quantity: "0.001",
        entryPrice: "100",
        takeProfitClientOrderId: "gv-exit-tp-test",
        takeProfitPrice: "104",
        stopLossClientOrderId: "gv-exit-sl-test",
        stopLossPrice: "98",
        stopLimitPrice: "97.9",
      }),
    ).rejects.toThrow("LIVE_TRADING_DISABLED");

    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not advertise withdrawals, margin, leverage, short selling, or derivatives", () => {
    const adapter = new BinanceSpotLiveAdapter({ liveTradingEnabled: false });

    expect(adapter.mode).toBe("LIVE");
    expect(adapter.capabilities.liveOrders).toBe(true);
    expect(adapter.capabilities.withdrawals).toBe(false);
    expect(adapter.capabilities.margin).toBe(false);
    expect(adapter.capabilities.leverage).toBe(false);
    expect(adapter.capabilities.shortSelling).toBe(false);
    expect(adapter.capabilities.derivatives).toBe(false);
  });
});
