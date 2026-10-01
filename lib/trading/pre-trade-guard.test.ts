import { describe, expect, it } from "vitest";
import { evaluatePreTrade, assertPreTradeAllowed } from "./pre-trade-guard";
import type { RiskConfig } from "./risk";

const riskConfig: RiskConfig = {
  maxTradeAmountUsd: 100,
  maxDailyLossUsd: 50,
  maxOpenTrades: 3,
  maxExposureUsd: 250,
  maxExposurePerAssetUsd: 100,
  maxConsecutiveLosses: 3,
  requireStopLoss: true,
  requireTakeProfit: true,
};

const baseInput = {
  shariah: {
    symbol: "TEST",
    assetType: "EQUITY",
    businessActivity: "software",
    tradingMethod: "SPOT" as const,
    ownershipSettlementVerified: true,
    financialRatios: {},
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
};

describe("evaluatePreTrade", () => {
  it("blocks REVIEW because financial screening is not configured", () => {
    const decision = evaluatePreTrade(baseInput);

    expect(decision.allowed).toBe(false);
    expect(decision.shariah.status).toBe("REVIEW");
    expect(decision.reasons).toContain("SHARIAH_REVIEW");
  });

  it("blocks explicitly prohibited trading methods", () => {
    const decision = evaluatePreTrade({
      ...baseInput,
      shariah: { ...baseInput.shariah, tradingMethod: "MARGIN" },
    });

    expect(decision.allowed).toBe(false);
    expect(decision.shariah.status).toBe("REJECTED");
    expect(decision.shariah.reasons).toContain("PROHIBITED_TRADING_METHOD:MARGIN");
  });

  it("blocks risk-limit violations even when Shariah is approved", () => {
    const decision = evaluatePreTrade({
      ...baseInput,
      shariahPolicy: {
        version: "test",
        prohibitedBusinessKeywords: [],
        prohibitedMethods: ["MARGIN", "LEVERAGED", "SHORT", "FUTURES", "OPTIONS", "UNKNOWN"],
        maxInterestBearingDebtRatio: 0.33,
        maxInterestIncomeRatio: 0.05,
        maxImpermissibleIncomeRatio: 0.05,
      },
      shariah: {
        ...baseInput.shariah,
        financialRatios: {
          interestBearingDebtRatio: 0.1,
          interestIncomeRatio: 0.01,
          impermissibleIncomeRatio: 0.01,
        },
      },
      riskSnapshot: {
        ...baseInput.riskSnapshot,
        requestedAmountUsd: 101,
      },
    });

    expect(decision.shariah.status).toBe("APPROVED");
    expect(decision.allowed).toBe(false);
    expect(decision.risk.reasons).toContain("MAX_TRADE_AMOUNT_EXCEEDED");
  });

  it("allows only when both policy layers approve", () => {
    const decision = evaluatePreTrade({
      ...baseInput,
      shariahPolicy: {
        version: "test",
        prohibitedBusinessKeywords: [],
        prohibitedMethods: ["MARGIN", "LEVERAGED", "SHORT", "FUTURES", "OPTIONS", "UNKNOWN"],
        maxInterestBearingDebtRatio: 0.33,
        maxInterestIncomeRatio: 0.05,
        maxImpermissibleIncomeRatio: 0.05,
      },
      shariah: {
        ...baseInput.shariah,
        financialRatios: {
          interestBearingDebtRatio: 0.1,
          interestIncomeRatio: 0.01,
          impermissibleIncomeRatio: 0.01,
        },
      },
    });

    expect(decision.allowed).toBe(true);
    expect(decision.reasons).toEqual([]);
    expect(() => assertPreTradeAllowed(decision)).not.toThrow();
  });
});
