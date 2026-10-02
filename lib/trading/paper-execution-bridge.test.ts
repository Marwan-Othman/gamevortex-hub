import { describe, expect, it } from "vitest";
import { buildTradingExecutionPlan, type TradingExecutionRequest } from "./executor";
import { openPaperPositionFromExecutionPlan } from "./paper-execution-bridge";

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

describe("openPaperPositionFromExecutionPlan", () => {
  it("bridges a guarded paper plan into a matching open position", () => {
    const plan = buildTradingExecutionPlan(planRequest());
    const result = openPaperPositionFromExecutionPlan({
      plan,
      positionId: "position-1",
      openedAt: "2026-10-02T08:00:00Z",
      shariahPolicyVersion: "v1.0",
    });

    expect(result.execution.clientOrderId).toBe(plan.clientOrderId);
    expect(result.execution.positionId).toBe("position-1");
    expect(result.position.status).toBe("OPEN");
    expect(result.position.symbol).toBe(plan.symbol);
    expect(result.position.amountUsd).toBe(plan.amountUsd);
    expect(result.position.entryPrice).toBe(plan.entryPrice);
    expect(result.position.stopLossPrice).toBe(plan.stopLossPrice);
    expect(result.position.takeProfitPrice).toBe(plan.takeProfitPrice);
    expect(result.position.shariahPolicyVersion).toBe("v1.0");
  });

  it("preserves the guarded execution identity", () => {
    const plan = buildTradingExecutionPlan(
      planRequest({
        ownerId: " owner-42 ",
        opportunityId: " opportunity-42 ",
        idempotencyKey: " paper-opportunity-42-v7 ",
      }),
    );
    const result = openPaperPositionFromExecutionPlan({
      plan,
      positionId: "position-42",
      openedAt: "2026-10-02T08:00:00Z",
      shariahPolicyVersion: "v1.0",
    });

    expect(result.execution.clientOrderId).toBe(plan.clientOrderId);
    expect(result.execution.clientOrderId).toMatch(/^gv-paper-[a-f0-9]{32}$/);
    expect(result.execution.symbol).toBe("TEST");
    expect(result.execution.amountUsd).toBe(10);
  });

  it("rejects a non-paper execution plan", () => {
    const plan = buildTradingExecutionPlan(planRequest());

    expect(() =>
      openPaperPositionFromExecutionPlan({
        plan: { ...plan, mode: "LIVE" } as never,
        positionId: "position-1",
        openedAt: "2026-10-02T08:00:00Z",
        shariahPolicyVersion: "v1.0",
      }),
    ).toThrow("PAPER_EXECUTION_PLAN_REQUIRED");
  });

  it("rejects an invalid position identifier", () => {
    const plan = buildTradingExecutionPlan(planRequest());

    expect(() =>
      openPaperPositionFromExecutionPlan({
        plan,
        positionId: "   ",
        openedAt: "2026-10-02T08:00:00Z",
        shariahPolicyVersion: "v1.0",
      }),
    ).toThrow("INVALID_POSITION_ID");
  });

  it("rejects an invalid opening timestamp", () => {
    const plan = buildTradingExecutionPlan(planRequest());

    expect(() =>
      openPaperPositionFromExecutionPlan({
        plan,
        positionId: "position-1",
        openedAt: "not-a-date",
        shariahPolicyVersion: "v1.0",
      }),
    ).toThrow("INVALID_POSITION_OPEN_TIME");
  });

  it("rejects a missing Shariah policy version", () => {
    const plan = buildTradingExecutionPlan(planRequest());

    expect(() =>
      openPaperPositionFromExecutionPlan({
        plan,
        positionId: "position-1",
        openedAt: "2026-10-02T08:00:00Z",
        shariahPolicyVersion: "   ",
      }),
    ).toThrow("INVALID_POSITION_SHARIAH_POLICY_VERSION");
  });

  it("rejects an excessively long Shariah policy version", () => {
    const plan = buildTradingExecutionPlan(planRequest());

    expect(() =>
      openPaperPositionFromExecutionPlan({
        plan,
        positionId: "position-1",
        openedAt: "2026-10-02T08:00:00Z",
        shariahPolicyVersion: "v".repeat(101),
      }),
    ).toThrow("INVALID_POSITION_SHARIAH_POLICY_VERSION");
  });

  it("rejects a policy version that does not match the guarded plan", () => {
    const plan = buildTradingExecutionPlan(planRequest());

    expect(() =>
      openPaperPositionFromExecutionPlan({
        plan,
        positionId: "position-1",
        openedAt: "2026-10-02T08:00:00Z",
        shariahPolicyVersion: "different-policy",
      }),
    ).toThrow("SHARIAH_POLICY_VERSION_MISMATCH");
  });
});
