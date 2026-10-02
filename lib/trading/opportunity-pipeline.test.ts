import { describe, expect, it } from "vitest";
import { buildOwnerPaperOpportunity, buildTradeProposal, buildApprovedPaperExecution } from "./opportunity-pipeline";
import { openPaperPosition, closePaperPosition } from "./position";
import { reconcilePaperExecution } from "./reconciliation";
import { settleClosedPaperPosition } from "./settlement";
import type { TradeOpportunityInput } from "./opportunity-pipeline";
import type { PaperExecutionRecord } from "./paper-execution-bridge";

const shariahPolicy = {
  version: "v1.0-test",
  prohibitedBusinessKeywords: ["alcohol", "casino", "gambling", "betting", "interest-based lending"],
  prohibitedMethods: ["MARGIN", "LEVERAGED", "SHORT", "FUTURES", "OPTIONS", "UNKNOWN"] as const,
  allowedMethods: ["SPOT"] as const,
  maxInterestBearingDebtRatio: 0.33,
  maxInterestIncomeRatio: 0.05,
  maxImpermissibleIncomeRatio: 0.05,
};

const riskConfig = {
  maxTradeAmountUsd: 100,
  maxDailyLossUsd: 20,
  maxOpenTrades: 2,
  maxExposureUsd: 100,
  maxExposurePerAssetUsd: 100,
  maxConsecutiveLosses: 3,
  requireStopLoss: true,
  requireTakeProfit: true,
};

function makeInput(overrides: Partial<TradeOpportunityInput> = {}): TradeOpportunityInput {
  return {
    ownerId: "owner-1",
    opportunityId: "opp-1",
    idempotencyKey: "idem-1",
    symbol: "ABC",
    amountUsd: 10,
    strategy: {
      price: 110,
      previousPrice: 109,
      fastAverage: 108,
      slowAverage: 100,
      volume: 2000,
      averageVolume: 1500,
      stopLossPercent: 5,
      takeProfitPercent: 10,
    },
    shariah: {
      symbol: "ABC",
      assetType: "EQUITY",
      businessActivity: "software services",
      financialRatios: {
        interestBearingDebtRatio: 0.1,
        interestIncomeRatio: 0.01,
        impermissibleIncomeRatio: 0.01,
      },
      tradingMethod: "SPOT",
      ownershipSettlementVerified: true,
      source: "test-fixture",
    },
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
    shariahPolicy,
    approval: {
      id: "approval-1",
      ownerId: "owner-1",
      opportunityId: "opp-1",
      status: "CONSUMED",
      amountUsd: 10,
      consumedAt: "2026-10-02T07:00:00.000Z",
    },
    ...overrides,
  };
}

describe("owner paper opportunity pipeline", () => {
  it("builds a fully guarded PAPER execution plan", () => {
    const result = buildOwnerPaperOpportunity(makeInput());
    expect(result.proposal.side).toBe("BUY");
    expect(result.proposal.preTrade.allowed).toBe(true);
    expect(result.proposal.preTrade.shariah.status).toBe("APPROVED");
    expect(result.executionPlan?.mode).toBe("PAPER");
    expect(result.executionPlan?.orderType).toBe("SPOT_MARKET");
    expect(result.executionPlan?.leverage).toBe(1);
    expect(result.executionPlan?.margin).toBe(false);
    expect(result.executionPlan?.short).toBe(false);
    expect(result.executionPlan?.withdrawalPermission).toBe(false);
  });

  it("runs an approved paper opportunity through position, reconciliation, and settlement", () => {
    const input = makeInput();
    const result = buildOwnerPaperOpportunity(input);
    const plan = result.executionPlan;
    expect(plan).toBeDefined();
    if (!plan) return;

    const position = openPaperPosition({
      positionId: "pos-e2e-001",
      symbol: plan.symbol,
      amountUsd: plan.amountUsd,
      entryPrice: plan.entryPrice,
      stopLossPrice: plan.stopLossPrice,
      takeProfitPrice: plan.takeProfitPrice,
      openedAt: "2026-10-02T07:01:00.000Z",
      shariahPolicyVersion: input.shariahPolicy!.version,
    });

    const execution: PaperExecutionRecord = {
      positionId: position.positionId,
      clientOrderId: plan.clientOrderId,
      symbol: position.symbol,
      amountUsd: position.amountUsd,
      entryPrice: position.entryPrice,
      stopLossPrice: position.stopLossPrice,
      takeProfitPrice: position.takeProfitPrice,
      shariahPolicyVersion: position.shariahPolicyVersion,
    };

    expect(reconcilePaperExecution(execution, position).status).toBe("MATCHED");

    const closed = closePaperPosition(position, {
      exitPrice: plan.takeProfitPrice!,
      reason: "TAKE_PROFIT",
      closedAt: "2026-10-02T08:01:00.000Z",
    });
    const settlement = settleClosedPaperPosition(closed);

    expect(closed.status).toBe("CLOSED");
    expect(closed.pnlUsd).toBeCloseTo(1, 10);
    expect(settlement.status).toBe("SETTLED");
    expect(settlement.settlementValueUsd).toBeCloseTo(11, 10);
  });

  it("creates a proposal before approval but refuses execution while approval is pending", () => {
    const input = makeInput({ approval: { id: "approval-1", ownerId: "owner-1", opportunityId: "opp-1", status: "PENDING", amountUsd: 10, consumedAt: null } });
    const proposal = buildTradeProposal(input);
    expect(proposal.approvalStatus).toBe("PENDING");
    expect(() => buildApprovedPaperExecution(input, proposal)).toThrow("OWNER_APPROVAL_NOT_CONSUMED");
  });

  it("rejects approval amount tampering before proposal creation", () => {
    const input = makeInput({ approval: { id: "approval-1", ownerId: "owner-1", opportunityId: "opp-1", status: "CONSUMED", amountUsd: 9, consumedAt: "2026-10-02T07:00:00.000Z" } });
    expect(() => buildTradeProposal(input)).toThrow("APPROVAL_AMOUNT_MISMATCH");
  });

  it("rejects an approval belonging to another owner", () => {
    const input = makeInput({ approval: { ...makeInput().approval, ownerId: "owner-2" } });
    const proposal = buildTradeProposal(makeInput());
    expect(() => buildApprovedPaperExecution(input, proposal)).toThrow("APPROVAL_OWNER_MISMATCH");
  });

  it("rejects an approval bound to another opportunity", () => {
    const input = makeInput({ approval: { ...makeInput().approval, opportunityId: "opp-2" } });
    const proposal = buildTradeProposal(makeInput());
    expect(() => buildApprovedPaperExecution(input, proposal)).toThrow("APPROVAL_OPPORTUNITY_MISMATCH");
  });

  it("rejects a non-finite approval amount", () => {
    const input = makeInput({ approval: { ...makeInput().approval, amountUsd: Number.NaN } });
    expect(() => buildTradeProposal(input)).toThrow("INVALID_APPROVAL_AMOUNT");
  });

  it("blocks a Shariah-rejected asset before proposal creation", () => {
    const input = makeInput({ shariah: { ...makeInput().shariah, businessActivity: "casino software and gambling" } });
    expect(() => buildTradeProposal(input)).toThrow("PRE_TRADE_BLOCKED");
  });

  it("blocks a trade when risk policy rejects the requested exposure", () => {
    const input = makeInput({ amountUsd: 50, riskSnapshot: { ...makeInput().riskSnapshot, requestedAmountUsd: 50, totalExposureUsd: 60 } });
    expect(() => buildTradeProposal(input)).toThrow("PRE_TRADE_BLOCKED");
  });

  it("blocks proposals without a deterministic BUY signal", () => {
    const input = makeInput({ strategy: { ...makeInput().strategy, price: 99, previousPrice: 100, fastAverage: 98, slowAverage: 100 } });
    expect(() => buildTradeProposal(input)).toThrow("NO_BUY_SIGNAL");
  });
});
