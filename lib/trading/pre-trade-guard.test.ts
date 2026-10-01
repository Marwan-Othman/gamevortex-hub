import { describe, expect, it } from "vitest";
import { assertPreTradeAllowed, evaluatePreTrade } from "./pre-trade-guard";

const shariahPolicy = {
  version: "test-v1",
  prohibitedBusinessKeywords: ["alcohol", "gambling", "casino", "interest-based lending"],
  prohibitedMethods: ["MARGIN", "LEVERAGED", "SHORT", "FUTURES", "OPTIONS", "UNKNOWN"] as const,
  allowedMethods: ["SPOT"] as const,
  maxInterestBearingDebtRatio: 0.30,
  maxInterestIncomeRatio: 0.05,
  maxImpermissibleIncomeRatio: 0.05,
};

const shariah = {
  symbol: "TEST",
  assetType: "EQUITY",
  businessActivity: "software development",
  financialRatios: {
    interestBearingDebtRatio: 0.05,
    interestIncomeRatio: 0.01,
    impermissibleIncomeRatio: 0.01,
  },
  tradingMethod: "SPOT" as const,
  ownershipSettlementVerified: true,
};

const riskConfig = {
  maxTradeAmountUsd: 100,
  maxDailyLossUsd: 100,
  maxOpenTrades: 2,
  maxExposureUsd: 200,
  maxExposurePerAssetUsd: 100,
  maxConsecutiveLosses: 3,
  requireStopLoss: true,
  requireTakeProfit: true,
};

const riskSnapshot = {
  requestedAmountUsd: 10,
  dailyLossUsd: 0,
  openTrades: 0,
  totalExposureUsd: 0,
  assetExposureUsd: 0,
  consecutiveLosses: 0,
  hasStopLoss: true,
  hasTakeProfit: true,
};

describe("evaluatePreTrade", () => {
  it("allows a signal only when both Shariah and risk gates pass", () => {
    const decision = evaluatePreTrade({ shariah, riskConfig, riskSnapshot, shariahPolicy });

    expect(decision.allowed).toBe(true);
    expect(decision.shariah.status).toBe("APPROVED");
    expect(decision.risk.allowed).toBe(true);
    expect(() => assertPreTradeAllowed(decision)).not.toThrow();
  });

  it("fails closed when the trading method is prohibited", () => {
    const decision = evaluatePreTrade({
      shariah: { ...shariah, tradingMethod: "MARGIN" },
      riskConfig,
      riskSnapshot,
      shariahPolicy,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.shariah.status).toBe("REJECTED");
    expect(decision.reasons).toContain("SHARIAH_REJECTED");
  });

  it("blocks trades that exceed risk limits", () => {
    const decision = evaluatePreTrade({
      shariah,
      riskConfig: { ...riskConfig, maxTradeAmountUsd: 5 },
      riskSnapshot,
      shariahPolicy,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.risk.reasons).toContain("MAX_TRADE_AMOUNT_EXCEEDED");
  });

  it("treats missing Shariah screening facts as non-approval", () => {
    const decision = evaluatePreTrade({
      shariah: { ...shariah, businessActivity: undefined },
      riskConfig,
      riskSnapshot,
      shariahPolicy,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.shariah.status).toBe("REVIEW");
    expect(decision.reasons).toContain("SHARIAH_REVIEW");
  });
});
