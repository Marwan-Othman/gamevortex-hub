import { describe, expect, it } from "vitest";
import { buildTradingExecutionPlan, type TradingExecutionRequest } from "./executor";
import { openPaperPositionFromExecutionPlan } from "./paper-execution-bridge";
import { reconcilePaperExecution } from "./reconciliation";

const shariah = {
  symbol: "TEST",
  assetType: "EQUITY",
  businessActivity: "software services",
  financialRatios: {
    interestBearingDebtRatio: 0.2,
    interestIncomeRatio: 0.02,
    impermissibleIncomeRatio: 0.01,
  },
  tradingMethod: "SPOT" as const,
  ownershipSettlementVerified: true,
};

const riskConfig = {
  maxTradeAmountUsd: 100,
  maxDailyLossUsd: 50,
  maxOpenTrades: 1,
  maxExposureUsd: 100,
  maxExposurePerAssetUsd: 100,
  maxConsecutiveLosses: 3,
  requireStopLoss: true,
  requireTakeProfit: false,
};

function planRequest(overrides: Partial<TradingExecutionRequest> = {}): TradingExecutionRequest {
  return {
    mode: "PAPER",
    ownerId: "owner-1",
    opportunityId: "opportunity-1",
    idempotencyKey: "paper-opportunity-1-v1",
    approvalConsumed: true,
    symbol: "TEST",
    amountUsd: 10,
    entryPrice: 100,
    stopLossPrice: 95,
    takeProfitPrice: 110,
    shariah,
    riskConfig,
    riskSnapshot: {
      requestedAmountUsd: 10,
      dailyLossUsd: 0,
      openTrades: 0,
      totalExposureUsd: 0,
      assetExposureUsd: 0,
      consecutiveLosses: 0,
      hasStopLoss: true,
      hasTakeProfit: true,
    },
    ...overrides,
  };
}

describe("reconcilePaperExecution", () => {
  it("matches an execution record with its resulting position", () => {
    const plan = buildTradingExecutionPlan(planRequest());
    const result = openPaperPositionFromExecutionPlan({
      plan,
      positionId: "position-1",
      openedAt: "2026-10-02T08:00:00Z",
      shariahPolicyVersion: "strict-v1",
    });

    expect(reconcilePaperExecution(result.execution, result.position)).toEqual({
      status: "MATCHED",
      positionId: "position-1",
      clientOrderId: plan.clientOrderId,
    });
  });

  it("reports every material mismatch instead of silently accepting drift", () => {
    const plan = buildTradingExecutionPlan(planRequest());
    const result = openPaperPositionFromExecutionPlan({
      plan,
      positionId: "position-1",
      openedAt: "2026-10-02T08:00:00Z",
      shariahPolicyVersion: "strict-v1",
    });

    const mismatched = {
      ...result.position,
      symbol: "OTHER",
      amountUsd: 11,
      entryPrice: 101,
      stopLossPrice: 94,
      takeProfitPrice: 111,
      shariahPolicyVersion: "strict-v2",
    };

    const reconciliation = reconcilePaperExecution(result.execution, mismatched);

    expect(reconciliation.status).toBe("MISMATCHED");
    if (reconciliation.status === "MISMATCHED") {
      expect(reconciliation.reasons).toEqual([
        "SYMBOL_MISMATCH",
        "AMOUNT_MISMATCH",
        "ENTRY_PRICE_MISMATCH",
        "STOP_LOSS_MISMATCH",
        "TAKE_PROFIT_MISMATCH",
        "SHARIAH_POLICY_VERSION_MISMATCH",
      ]);
    }
  });

  it("detects a position identity mismatch", () => {
    const plan = buildTradingExecutionPlan(planRequest());
    const result = openPaperPositionFromExecutionPlan({
      plan,
      positionId: "position-1",
      openedAt: "2026-10-02T08:00:00Z",
      shariahPolicyVersion: "strict-v1",
    });

    const reconciliation = reconcilePaperExecution(result.execution, {
      ...result.position,
      positionId: "position-2",
    });

    expect(reconciliation.status).toBe("MISMATCHED");
    if (reconciliation.status === "MISMATCHED") {
      expect(reconciliation.reasons).toEqual(["POSITION_ID_MISMATCH"]);
    }
  });

  it("reports client-order drift through the execution identity returned to the caller", () => {
    const plan = buildTradingExecutionPlan(planRequest());
    const result = openPaperPositionFromExecutionPlan({
      plan,
      positionId: "position-1",
      openedAt: "2026-10-02T08:00:00Z",
      shariahPolicyVersion: "strict-v1",
    });

    const reconciliation = reconcilePaperExecution(result.execution, {
      ...result.position,
      amountUsd: 12,
    });

    expect(reconciliation.status).toBe("MISMATCHED");
    expect(reconciliation.clientOrderId).toBe(result.execution.clientOrderId);
    expect(reconciliation.positionId).toBe("position-1");
  });
});
