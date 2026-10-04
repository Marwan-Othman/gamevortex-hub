import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { signBinancePayload } from "@/lib/trading/binance-signer";
import { getBinanceLivePreflight } from "@/lib/trading/binance-live-preflight";

describe("Binance live HMAC signing", () => {
  afterEach(() => {
    delete process.env.BINANCE_LIVE_API_KEY;
    delete process.env.BINANCE_LIVE_API_SECRET;
    delete process.env.BINANCE_LIVE_API_PRIVATE_KEY;
    delete process.env.GAMEVORTEX_LIVE_TRADING_ENABLED;
    vi.restoreAllMocks();
  });

  it("matches Binance HMAC-SHA256 signing semantics", () => {
    const payload = "symbol=BTCUSDT&timestamp=1499827319559";
    const secret = "test-secret";
    expect(signBinancePayload(payload, { apiSecret: secret })).toBe(
      createHmac("sha256", secret).update(payload, "utf8").digest("hex"),
    );
  });

  it("runs production preflight with the documented API secret contract", async () => {
    process.env.BINANCE_LIVE_API_KEY = "test-key";
    process.env.BINANCE_LIVE_API_SECRET = "test-secret";
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

    expect(result.readyForLiveExecution).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("classifies provider failures instead of leaking them as INTERNAL_ERROR", async () => {
    process.env.BINANCE_LIVE_API_KEY = "test-key";
    process.env.BINANCE_LIVE_API_SECRET = "test-secret";
    process.env.GAMEVORTEX_LIVE_TRADING_ENABLED = "false";

    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(JSON.stringify({ code: -1022, msg: "INVALID_SIGNATURE" }), { status: 400 }),
    );

    await expect(getBinanceLivePreflight(fetcher)).rejects.toThrow("BINANCE_LIVE_SIGNATURE_INVALID");
  });
});
