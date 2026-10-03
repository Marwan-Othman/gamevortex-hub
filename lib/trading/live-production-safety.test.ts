import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BinanceSpotLiveAdapter } from "@/lib/trading/binance-spot-live-adapter";
import { getBinanceLivePreflight } from "@/lib/trading/binance-live-preflight";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

function makeEd25519PrivateKeyPem(): string {
  const { privateKey } = generateKeyPairSync("ed25519");
  return privateKey.export({ type: "pkcs8", format: "pem" }).toString();
}

describe("live production safety boundary", () => {
  it("never reports live readiness while the application live flag is disabled", async () => {
    process.env.BINANCE_LIVE_API_KEY = "key";
    process.env.BINANCE_LIVE_API_PRIVATE_KEY = makeEd25519PrivateKeyPem();
    delete process.env.BINANCE_LIVE_API_SECRET;
    process.env.GAMEVORTEX_LIVE_TRADING_ENABLED = "false";

    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/api/v3/account")) {
        return new Response(
          JSON.stringify({ canTrade: true, canWithdraw: false, canDeposit: true, accountType: "SPOT", permissions: ["SPOT"] }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          ipRestrict: true,
          enableReading: true,
          enableWithdrawals: false,
          enableInternalTransfer: false,
          enableMargin: false,
          enableFutures: false,
          enableVanillaOptions: false,
          enableSpotAndMarginTrading: true,
          enablePortfolioMarginTrading: false,
        }),
        { status: 200 },
      );
    });

    const result = await getBinanceLivePreflight(fetcher);

    expect(result.readyForLiveExecution).toBe(false);
    expect(result.checks.liveFlagEnabled).toBe(false);
    expect(result.blockers).toContain("GAMEVORTEX_LIVE_TRADING_DISABLED");
  });

  it("blocks provider order submission before any network request when live trading is disabled", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const adapter = new BinanceSpotLiveAdapter({
      apiKey: "key",
      apiPrivateKeyPem: makeEd25519PrivateKeyPem(),
      liveTradingEnabled: false,
      fetcher,
    });

    await expect(
      adapter.placeSpotBuy({
        clientOrderId: "gv-live-test-order",
        symbol: "BTCUSDT",
        side: "BUY",
        amountUsd: 1,
        entryPrice: 100,
        stopLossPrice: 98,
        takeProfitPrice: 104,
      }),
    ).rejects.toThrow("LIVE_TRADING_DISABLED");

    expect(fetcher).not.toHaveBeenCalled();
  });
});
