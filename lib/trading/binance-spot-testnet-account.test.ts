import { describe, expect, it } from "vitest";
import { BinanceSpotTestnetAdapter } from "@/lib/trading/binance-spot-testnet-adapter";

describe("BinanceSpotTestnetAdapter.getAccountStatus", () => {
  it("reads account trading permissions server-side without exposing credentials", async () => {
    let requestedUrl = "";
    let receivedApiKey = "";

    const adapter = new BinanceSpotTestnetAdapter({
      apiKey: "test-api-key",
      apiSecret: "test-api-secret",
      fetcher: async (input, init) => {
        requestedUrl = String(input);
        receivedApiKey = String(new Headers(init?.headers).get("X-MBX-APIKEY"));
        return new Response(
          JSON.stringify({
            canTrade: true,
            canWithdraw: false,
            canDeposit: true,
            accountType: "SPOT",
            permissions: ["SPOT"],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    const status = await adapter.getAccountStatus();

    expect(status).toEqual({
      canTrade: true,
      canWithdraw: false,
      canDeposit: true,
      accountType: "SPOT",
      permissions: ["SPOT"],
    });
    expect(requestedUrl).toContain("https://testnet.binance.vision/api/v3/account?");
    expect(requestedUrl).toContain("signature=");
    expect(receivedApiKey).toBe("test-api-key");
    expect(requestedUrl).not.toContain("test-api-secret");
  });

  it("fails closed when credentials are missing", async () => {
    const adapter = new BinanceSpotTestnetAdapter({ fetcher: fetch });
    await expect(adapter.getAccountStatus()).rejects.toThrow("BINANCE_TESTNET_API_CREDENTIALS_REQUIRED");
  });

  it("maps a provider location restriction to a stable internal error", async () => {
    const adapter = new BinanceSpotTestnetAdapter({
      apiKey: "test-api-key",
      apiSecret: "test-api-secret",
      fetcher: async () =>
        new Response(
          JSON.stringify({
            code: -1000,
            msg: "BINANCE_TESTNET_Service unavailable from a restricted location according to eligibility.",
          }),
          { status: 500, headers: { "content-type": "application/json" } },
        ),
    });

    await expect(adapter.getAccountStatus()).rejects.toThrow("BINANCE_TESTNET_RESTRICTED_LOCATION");
  });

  it("rejects an account response without explicit permission fields", async () => {
    const adapter = new BinanceSpotTestnetAdapter({
      apiKey: "test-api-key",
      apiSecret: "test-api-secret",
      fetcher: async () => new Response(JSON.stringify({ accountType: "SPOT" }), { status: 200 }),
    });

    await expect(adapter.getAccountStatus()).rejects.toThrow("INVALID_BINANCE_TESTNET_ACCOUNT_RESPONSE");
  });
});
