import { describe, expect, it, vi, beforeEach } from "vitest";

const requireTradingOwner = vi.fn();
const getBinanceSpotTestnetAdapter = vi.fn();
const tradingRouteError = vi.fn();

vi.mock("@/lib/trading/access", () => ({
  requireTradingOwner,
}));

vi.mock("@/lib/trading/binance-spot-testnet-config", () => ({
  getBinanceSpotTestnetAdapter,
}));

vi.mock("@/lib/trading/route-helpers", () => ({
  tradingRouteError,
}));

import { GET } from "./route";

describe("GET /api/admin/trading/exchange/testnet/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tradingRouteError.mockImplementation(
      async (error: unknown) =>
        new Response(
          JSON.stringify({ error: error instanceof Error ? error.message : "INTERNAL_ERROR" }),
          { status: 500, headers: { "content-type": "application/json" } },
        ),
    );
  });

  it("requires the trading owner", async () => {
    requireTradingOwner.mockRejectedValueOnce(new Error("FORBIDDEN"));

    const response = await GET();

    expect(response.status).toBe(500);
    expect(getBinanceSpotTestnetAdapter).not.toHaveBeenCalled();
  });

  it("reports a safe Testnet account only when trading is enabled and withdrawals are disabled", async () => {
    requireTradingOwner.mockResolvedValueOnce({ id: "owner-1", role: "SUPER_ADMIN" });
    getBinanceSpotTestnetAdapter.mockReturnValueOnce({
      getAccountStatus: vi.fn().mockResolvedValueOnce({
        canTrade: true,
        canWithdraw: false,
        canDeposit: true,
        accountType: "SPOT",
        permissions: ["SPOT"],
      }),
    });

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.readyForTestnetOrder).toBe(true);
    expect(payload.account.canWithdraw).toBe(false);
    expect(payload.account.permissions).toEqual(["SPOT"]);
  });

  it("does not claim readiness without Spot permission", async () => {
    requireTradingOwner.mockResolvedValueOnce({ id: "owner-1", role: "SUPER_ADMIN" });
    getBinanceSpotTestnetAdapter.mockReturnValueOnce({
      getAccountStatus: vi.fn().mockResolvedValueOnce({
        canTrade: true,
        canWithdraw: false,
        canDeposit: true,
        accountType: "SPOT",
        permissions: [],
      }),
    });

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.readyForTestnetOrder).toBe(false);
  });
});
