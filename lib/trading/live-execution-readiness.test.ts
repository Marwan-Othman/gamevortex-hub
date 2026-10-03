import { describe, expect, it } from "vitest";
import { evaluateLiveExecutionReadiness, type LiveExecutionReadinessInput } from "./live-execution-readiness";
import type { ExchangeAdapter } from "./exchange-adapter";

const adapter: ExchangeAdapter = {
  id: "fake-live",
  mode: "LIVE",
  capabilities: {
    marketData: true,
    paperTrading: false,
    liveOrders: true,
    withdrawals: false,
    margin: false,
    leverage: false,
    shortSelling: false,
    derivatives: false,
  },
  getMarketData: async () => ({ symbol: "TEST", interval: "1m", candles: [] }),
  placeSpotBuy: async () => ({ accepted: false, clientOrderId: "dry-run", status: "REJECTED" as const }),
  getOrderStatus: async () => ({
    observation: {
      clientOrderId: "dry-run",
      providerOrderId: "dry-run",
      symbol: "TEST",
      side: "BUY" as const,
      status: "UNKNOWN" as const,
      executedQty: 0,
      cumulativeQuoteQty: 0,
      updatedAt: new Date(),
    },
  }),
  placeProtectedExitOco: async () => ({
    accepted: false,
    orderListId: "dry-run",
    listClientOrderId: "dry-run",
    orders: [],
    status: "REJECTED",
  }),
};

const input: LiveExecutionReadinessInput = {
  liveTradingEnabled: false,
  credentialsConfigured: false,
  ownerApprovalValid: true,
  shariahApproved: true,
  riskApproved: true,
  emergencyStopActive: false,
  withdrawalsDisabled: true,
  amountUsd: 10,
  symbol: "TEST",
  entryPrice: 100,
  stopLossPrice: 95,
  takeProfitPrice: 110,
  stopLimitPrice: 94.5,
  filledQuantity: 0.1,
  clientOrderId: "gv-live-test",
};

describe("evaluateLiveExecutionReadiness", () => {
  it("remains blocked while live trading is disabled", () => {
    const result = evaluateLiveExecutionReadiness(input, adapter);
    expect(result.ready).toBe(false);
    expect(result.reasons).toContain("LIVE_TRADING_DISABLED");
    expect(result.reasons).toContain("LIVE_CREDENTIALS_NOT_CONFIGURED");
    expect(result.protectedExit).toBeNull();
  });

  it("validates the full protected-exit sequence without network calls", () => {
    const result = evaluateLiveExecutionReadiness(
      { ...input, liveTradingEnabled: true, credentialsConfigured: true },
      adapter,
    );
    expect(result.ready).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.sequence).toEqual([
      "INTENT_CREATED",
      "SUBMITTING",
      "PROVIDER_RECONCILIATION",
      "FILLED",
      "PROTECTION_PENDING",
      "PROTECTED",
    ]);
    expect(result.protectedExit?.side).toBe("SELL");
    expect(result.protectedExit?.contingencyType).toBe("OCO");
  });

  it("keeps the $1 minimum while leaving the upper bound to risk controls", () => {
    const result = evaluateLiveExecutionReadiness(
      { ...input, amountUsd: 100000, liveTradingEnabled: true, credentialsConfigured: true },
      adapter,
    );
    expect(result.ready).toBe(true);
  });
});
