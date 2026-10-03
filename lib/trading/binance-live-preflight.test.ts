import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getBinanceLivePreflight } from "@/lib/trading/binance-live-preflight";

const ENV_KEYS = ["BINANCE_LIVE_API_KEY", "BINANCE_LIVE_API_PRIVATE_KEY", "BINANCE_LIVE_API_SECRET", "GAMEVORTEX_LIVE_TRADING_ENABLED"] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function makeEd25519PrivateKeyPem(): string {
  const { privateKey } = generateKeyPairSync("ed25519");
  return privateKey.export({ type: "pkcs8", format: "pem" }).toString();
}

describe("getBinanceLivePreflight", () => {
  it("fails closed without production credentials", async () => {
    delete process.env.BINANCE_LIVE_API_KEY;
    delete process.env.BINANCE_LIVE_API_PRIVATE_KEY;
    delete process.env.BINANCE_LIVE_API_SECRET;
    delete process.env.GAMEVORTEX_LIVE_TRADING_ENABLED;

    const result = await getBinanceLivePreflight();

    expect(result.credentialsConfigured).toBe(false);
    expect(result.readyForLiveExecution).toBe(false);
    expect(result.blockers).toEqual([
      "BINANCE_LIVE_API_CREDENTIALS_REQUIRED",
      "GAMEVORTEX_LIVE_TRADING_DISABLED",
    ]);
  });

  it("surfaces Binance restricted-location responses as a safe blocker", async () => {
    process.env.BINANCE_LIVE_API_KEY = "test-key";
    process.env.BINANCE_LIVE_API_PRIVATE_KEY = makeEd25519PrivateKeyPem();
    delete process.env.BINANCE_LIVE_API_SECRET;
    process.env.GAMEVORTEX_LIVE_TRADING_ENABLED = "false";

    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: -2015,
          msg: "BINANCE_LIVE_Service unavailable from a restricted location according to 'b. Eligibility' in https://www.binance.com/en/terms.",
        }),
        { status: 403 },
      ),
    );

    await expect(getBinanceLivePreflight(fetcher)).rejects.toThrow("BINANCE_LIVE_RESTRICTED_LOCATION");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("passes a Spot account when Binance returns a trading-group permission instead of the literal SPOT permission", async () => {
    process.env.BINANCE_LIVE_API_KEY = "test-key";
    process.env.BINANCE_LIVE_API_PRIVATE_KEY = makeEd25519PrivateKeyPem();
    delete process.env.BINANCE_LIVE_API_SECRET;
    process.env.GAMEVORTEX_LIVE_TRADING_ENABLED = "true";

    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        canTrade: true,
        canWithdraw: true,
        canDeposit: true,
        accountType: "SPOT",
        permissions: ["TRD_GRP_082"],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ipRestrict: true,
        enableReading: true,
        enableWithdrawals: false,
        enableInternalTransfer: false,
        enableMargin: false,
        enableFutures: false,
        enableVanillaOptions: false,
        enableSpotAndMarginTrading: true,
        enablePortfolioMarginTrading: false,
      }), { status: 200 }));

    const result = await getBinanceLivePreflight(fetcher);

    expect(result.checks.spotAccount).toBe(true);
    expect(result.readyForLiveExecution).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[0]?.[0])).toContain("https://api.binance.com/api/v3/account?");
    expect(String(fetcher.mock.calls[1]?.[0])).toContain("https://api.binance.com/sapi/v1/account/apiRestrictions?");
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ headers: { "X-MBX-APIKEY": "test-key" } });
  });

  it("blocks immediately when the API key can withdraw", async () => {
    process.env.BINANCE_LIVE_API_KEY = "test-key";
    process.env.BINANCE_LIVE_API_PRIVATE_KEY = makeEd25519PrivateKeyPem();
    delete process.env.BINANCE_LIVE_API_SECRET;
    process.env.GAMEVORTEX_LIVE_TRADING_ENABLED = "true";

    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        canTrade: true,
        canWithdraw: true,
        canDeposit: true,
        accountType: "SPOT",
        permissions: ["TRD_GRP_082"],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ipRestrict: true,
        enableReading: true,
        enableWithdrawals: true,
        enableInternalTransfer: false,
        enableMargin: false,
        enableFutures: false,
        enableVanillaOptions: false,
        enableSpotAndMarginTrading: true,
        enablePortfolioMarginTrading: false,
      }), { status: 200 }));

    const result = await getBinanceLivePreflight(fetcher);

    expect(result.readyForLiveExecution).toBe(false);
    expect(result.blockers).toContain("BINANCE_LIVE_WITHDRAWALS_MUST_BE_DISABLED");
  });
});
