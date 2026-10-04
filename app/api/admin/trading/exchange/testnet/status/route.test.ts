import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ requireTradingOwner: vi.fn(), getBinanceSpotTestnetAdapter: vi.fn(), tradingRouteError: vi.fn() }));
vi.mock("@/lib/trading/access", () => ({ requireTradingOwner: mocks.requireTradingOwner }));
vi.mock("@/lib/trading/binance-spot-testnet-config", () => ({ getBinanceSpotTestnetAdapter: mocks.getBinanceSpotTestnetAdapter }));
vi.mock("@/lib/trading/route-helpers", () => ({ tradingRouteError: mocks.tradingRouteError }));
import { GET } from "./route";

describe("GET /api/admin/trading/exchange/testnet/status", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.tradingRouteError.mockImplementation(async (error: unknown) => new Response(JSON.stringify({ error: error instanceof Error ? error.message : "INTERNAL_ERROR" }), { status: 500, headers: { "content-type": "application/json" } })); });
  it("requires the trading owner", async () => { mocks.requireTradingOwner.mockRejectedValueOnce(new Error("FORBIDDEN")); const response = await GET(); expect(response.status).toBe(500); expect(mocks.getBinanceSpotTestnetAdapter).not.toHaveBeenCalled(); });
  it("reports a safe Testnet account when trading is enabled", async () => { mocks.requireTradingOwner.mockResolvedValueOnce({ id: "owner-1", role: "SUPER_ADMIN" }); mocks.getBinanceSpotTestnetAdapter.mockReturnValueOnce({ getAccountStatus: vi.fn().mockResolvedValueOnce({ canTrade: true, canWithdraw: false, canDeposit: true, accountType: "SPOT", permissions: ["SPOT"] }) }); const response = await GET(); const payload = await response.json(); expect(response.status).toBe(200); expect(payload.readyForTestnetOrder).toBe(true); expect(payload.account.canWithdraw).toBe(false); expect(payload.account.permissions).toEqual(["SPOT"]); });
  it("does not claim readiness without Spot permission", async () => { mocks.requireTradingOwner.mockResolvedValueOnce({ id: "owner-1", role: "SUPER_ADMIN" }); mocks.getBinanceSpotTestnetAdapter.mockReturnValueOnce({ getAccountStatus: vi.fn().mockResolvedValueOnce({ canTrade: true, canWithdraw: false, canDeposit: true, accountType: "SPOT", permissions: [] }) }); const response = await GET(); const payload = await response.json(); expect(response.status).toBe(200); expect(payload.readyForTestnetOrder).toBe(false); });
  it("does not block Testnet readiness when the (virtual) withdraw flag is on", async () => { mocks.requireTradingOwner.mockResolvedValueOnce({ id: "owner-1", role: "SUPER_ADMIN" }); mocks.getBinanceSpotTestnetAdapter.mockReturnValueOnce({ getAccountStatus: vi.fn().mockResolvedValueOnce({ canTrade: true, canWithdraw: true, canDeposit: true, accountType: "SPOT", permissions: ["SPOT"] }) }); const response = await GET(); const payload = await response.json(); expect(payload.readyForTestnetOrder).toBe(true); });
});
