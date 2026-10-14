import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireTradingOwner: vi.fn(),
  getBinanceLivePreflight: vi.fn(),
  createLiveExchangeAdapter: vi.fn(),
  getConfiguredLiveExchange: vi.fn(),
  tradingRouteError: vi.fn(),
}));

vi.mock("@/lib/trading/access", () => ({
  requireTradingOwner: mocks.requireTradingOwner,
}));
vi.mock("@/lib/trading/binance-live-preflight", () => ({
  getBinanceLivePreflight: mocks.getBinanceLivePreflight,
}));
vi.mock("@/lib/trading/live-exchange", () => ({
  createLiveExchangeAdapter: mocks.createLiveExchangeAdapter,
  getConfiguredLiveExchange: mocks.getConfiguredLiveExchange,
}));
vi.mock("@/lib/trading/route-helpers", () => ({
  tradingRouteError: mocks.tradingRouteError,
}));

import { GET } from "./route";

describe("GET /api/admin/trading/exchange/live/preflight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireTradingOwner.mockResolvedValue({ id: "owner-1", role: "SUPER_ADMIN" });
    mocks.tradingRouteError.mockImplementation(async (error: unknown) =>
      new Response(JSON.stringify({ error: error instanceof Error ? error.message : "INTERNAL_ERROR" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );
  });

  it("never reports Binance live execution ready before wallet funding and settlement are verified", async () => {
    mocks.getConfiguredLiveExchange.mockReturnValue("BINANCE");
    mocks.getBinanceLivePreflight.mockResolvedValue({
      credentialsConfigured: true,
      ready: true,
      blockers: [],
      checks: { spotTrading: true, withdrawalsDisabled: true },
    });

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.readyForLiveExecution).toBe(false);
    expect(payload.blockers).toContain("LIVE_TRADING_ACCOUNTING_NOT_READY");
    expect(payload.realMoney).toBe(false);
    expect(mocks.getBinanceLivePreflight).toHaveBeenCalledOnce();
  });

  it("never reports Bybit live execution ready while accounting and native linked protection are blocked", async () => {
    mocks.getConfiguredLiveExchange.mockReturnValue("BYBIT");
    mocks.createLiveExchangeAdapter.mockReturnValue({
      id: "bybit-spot-live",
      getLiveReadiness: vi.fn().mockResolvedValue({
        accountMode: 3,
        marginMode: "REGULAR_MARGIN",
        quoteAsset: "USDT",
        quoteFreeBalance: 100,
        blockers: [],
      }),
    });

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.readyForLiveExecution).toBe(false);
    expect(payload.blockers).toContain("LIVE_TRADING_ACCOUNTING_NOT_READY");
    expect(payload.blockers).toContain("BYBIT_NATIVE_LINKED_PROTECTION_NOT_IMPLEMENTED");
    expect(payload.realMoney).toBe(false);
  });

  it("does not query exchange preflight if owner authorization fails", async () => {
    mocks.requireTradingOwner.mockRejectedValueOnce(new Error("FORBIDDEN"));
    const response = await GET();

    expect(response.status).toBe(500);
    expect(mocks.getBinanceLivePreflight).not.toHaveBeenCalled();
    expect(mocks.createLiveExchangeAdapter).not.toHaveBeenCalled();
  });
});
