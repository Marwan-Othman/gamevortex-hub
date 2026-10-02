import { describe, expect, it } from "vitest";
import { buildTradingExecutionPlan, type TradingExecutionRequest } from "./executor";

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

function request(overrides: Partial<TradingExecutionRequest> = {}): TradingExecutionRequest {
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

describe("buildTradingExecutionPlan", () => {
  it("builds a normalized paper-only spot BUY plan", () => {
    const plan = buildTradingExecutionPlan(request());

    expect(plan.status).toBe("PAPER_READY");
    expect(plan.mode).toBe("PAPER");
    expect(plan.symbol).toBe("TEST");
    expect(plan.side).toBe("BUY");
    expect(plan.orderType).toBe("SPOT_MARKET");
    expect(plan.leverage).toBe(1);
    expect(plan.margin).toBe(false);
    expect(plan.short).toBe(false);
    expect(plan.withdrawalPermission).toBe(false);
    expect(plan.preTrade.allowed).toBe(true);
    expect(plan.clientOrderId).toMatch(/^gv-paper-[a-f0-9]{32}$/);
  });

  it("normalizes symbols before creating the plan", () => {
    const plan = buildTradingExecutionPlan(request({ symbol: "  test  " }));
    expect(plan.symbol).toBe("TEST");
  });

  it("rejects symbols containing unsupported characters", () => {
    expect(() => buildTradingExecutionPlan(request({ symbol: "TEST/USDT" }))).toThrow(
      "INVALID_EXECUTION_SYMBOL",
    );
  });

  it("rejects blank owner, opportunity, and idempotency identifiers", () => {
    expect(() => buildTradingExecutionPlan(request({ ownerId: "   " }))).toThrow(
      "INVALID_EXECUTION_OWNER",
    );
    expect(() => buildTradingExecutionPlan(request({ opportunityId: "   " }))).toThrow(
      "INVALID_EXECUTION_OPPORTUNITY",
    );
    expect(() => buildTradingExecutionPlan(request({ idempotencyKey: "   " }))).toThrow(
      "INVALID_EXECUTION_IDEMPOTENCY_KEY",
    );
  });

  it("is deterministic for the same idempotency key", () => {
    const first = buildTradingExecutionPlan(request());
    const second = buildTradingExecutionPlan(request());
    expect(first.clientOrderId).toBe(second.clientOrderId);
  });

  it("produces a different client order id for a different idempotency key", () => {
    const first = buildTradingExecutionPlan(request());
    const second = buildTradingExecutionPlan(
      request({ idempotencyKey: "paper-opportunity-1-v2" }),
    );
    expect(first.clientOrderId).not.toBe(second.clientOrderId);
  });

  it("requires a consumed owner approval", () => {
    expect(() => buildTradingExecutionPlan(request({ approvalConsumed: false }))).toThrow(
      "OWNER_APPROVAL_REQUIRED",
    );
  });

  it("rejects amounts below the $1 minimum", () => {
    expect(() => buildTradingExecutionPlan(request({ amountUsd: 0.99 }))).toThrow(
      "INVALID_TRADE_AMOUNT",
    );
  });

  it("rejects non-finite trade amounts", () => {
    expect(() => buildTradingExecutionPlan(request({ amountUsd: Number.NaN }))).toThrow(
      "INVALID_TRADE_AMOUNT",
    );
    expect(() => buildTradingExecutionPlan(request({ amountUsd: Number.POSITIVE_INFINITY }))).toThrow(
      "INVALID_TRADE_AMOUNT",
    );
  });

  it("rejects a stop loss that is not below the BUY entry", () => {
    expect(() => buildTradingExecutionPlan(request({ stopLossPrice: 100 }))).toThrow(
      "INVALID_STOP_LOSS_FOR_BUY",
    );
  });

  it("rejects a take profit that is not above the BUY entry", () => {
    expect(() => buildTradingExecutionPlan(request({ takeProfitPrice: 100 }))).toThrow(
      "INVALID_TAKE_PROFIT_FOR_BUY",
    );
  });

  it("fails closed when Shariah screening is not approved", () => {
    expect(() =>
      buildTradingExecutionPlan(
        request({
          shariah: { ...shariah, ownershipSettlementVerified: false },
        }),
      ),
    ).toThrow("SHARIAH_REVIEW");
  });

  it("fails closed when risk blocks the amount", () => {
    expect(() =>
      buildTradingExecutionPlan(
        request({
          riskConfig: { ...riskConfig, maxTradeAmountUsd: 5 },
        }),
      ),
    ).toThrow(/RISK_BLOCKED:.*MAX_TRADE_AMOUNT_EXCEEDED/);
  });

  it("fails closed when daily loss already reaches the configured limit", () => {
    expect(() =>
      buildTradingExecutionPlan(
        request({
          riskSnapshot: {
            ...request().riskSnapshot,
            dailyLossUsd: 50,
          },
        }),
      ),
    ).toThrow(/RISK_BLOCKED:.*MAX_DAILY_LOSS_EXCEEDED/);
  });

  it("fails closed when the maximum number of open trades is reached", () => {
    expect(() =>
      buildTradingExecutionPlan(
        request({
          riskSnapshot: {
            ...request().riskSnapshot,
            openTrades: 1,
          },
        }),
      ),
    ).toThrow(/RISK_BLOCKED:.*MAX_OPEN_TRADES_EXCEEDED/);
  });

  it("fails closed when total exposure would exceed the configured limit", () => {
    expect(() =>
      buildTradingExecutionPlan(
        request({
          riskSnapshot: {
            ...request().riskSnapshot,
            totalExposureUsd: 95,
          },
        }),
      ),
    ).toThrow(/RISK_BLOCKED:.*MAX_EXPOSURE_EXCEEDED/);
  });

  it("fails closed when the asset exposure would exceed the configured limit", () => {
    expect(() =>
      buildTradingExecutionPlan(
        request({
          riskSnapshot: {
            ...request().riskSnapshot,
            assetExposureUsd: 95,
          },
        }),
      ),
    ).toThrow(/RISK_BLOCKED:.*MAX_ASSET_EXPOSURE_EXCEEDED/);
  });

  it("fails closed when consecutive losses reach the configured limit", () => {
    expect(() =>
      buildTradingExecutionPlan(
        request({
          riskSnapshot: {
            ...request().riskSnapshot,
            consecutiveLosses: 3,
          },
        }),
      ),
    ).toThrow(/RISK_BLOCKED:.*MAX_CONSECUTIVE_LOSSES_EXCEEDED/);
  });

  it("rejects live mode until a reviewed exchange adapter exists", () => {
    expect(() => buildTradingExecutionPlan(request({ mode: "LIVE" }))).toThrow(
      "LIVE_EXECUTION_DISABLED",
    );
  });

  it("does not permit short selling through the execution contract", () => {
    expect(() =>
      buildTradingExecutionPlan(
        request({
          shariah: { ...shariah, tradingMethod: "SHORT" },
        }),
      ),
    ).toThrow("SHARIAH_REJECTED");
  });
});
