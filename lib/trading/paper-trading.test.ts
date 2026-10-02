import { describe, expect, it } from "vitest";
import { runPaperTrading } from "./paper-trading";

const shariahPolicy = {
  version: "paper-v1",
  prohibitedBusinessKeywords: ["alcohol", "gambling", "casino"],
  prohibitedMethods: ["MARGIN", "LEVERAGED", "SHORT", "FUTURES", "OPTIONS", "UNKNOWN"] as const,
  allowedMethods: ["SPOT"] as const,
  maxInterestBearingDebtRatio: 0.30,
  maxInterestIncomeRatio: 0.05,
  maxImpermissibleIncomeRatio: 0.05,
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

function tick(overrides: Partial<Parameters<typeof runPaperTrading>[1][number]> = {}) {
  return {
    timestamp: "2026-01-01T00:00:00Z",
    price: 110,
    previousPrice: 105,
    fastAverage: 108,
    slowAverage: 100,
    volume: 1200,
    averageVolume: 1000,
    shariah: {
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
    },
    ...overrides,
  };
}

describe("runPaperTrading", () => {
  it("opens only after both policy gates pass and exits at take profit", () => {
    const result = runPaperTrading(
      {
        symbol: "TEST",
        startingCapitalUsd: 100,
        tradeAmountUsd: 10,
        stopLossPercent: 2,
        takeProfitPercent: 4,
        riskConfig,
        shariahPolicy,
      },
      [
        tick({ timestamp: "2026-01-01T00:00:00Z" }),
        tick({ timestamp: "2026-01-01T00:05:00Z", price: 114.4, previousPrice: 110, fastAverage: 112 }),
      ],
    );

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].exitReason).toBe("TAKE_PROFIT");
    expect(result.trades[0].pnlUsd).toBeCloseTo(0.4, 8);
    expect(result.trades[0].shariahPolicyVersion).toBe("paper-v1");
    expect(result.lastPreTradeDecision?.allowed).toBe(true);
  });

  it("preserves the Shariah policy version when a position closes at end of data", () => {
    const result = runPaperTrading(
      {
        symbol: "TEST",
        startingCapitalUsd: 100,
        tradeAmountUsd: 10,
        stopLossPercent: 2,
        takeProfitPercent: 50,
        riskConfig,
        shariahPolicy,
      },
      [
        tick({ timestamp: "2026-01-01T00:00:00Z", price: 110 }),
        tick({ timestamp: "2026-01-01T00:05:00Z", price: 111, previousPrice: 110, fastAverage: 110.5 }),
      ],
    );

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].exitReason).toBe("END_OF_DATA");
    expect(result.trades[0].shariahPolicyVersion).toBe(shariahPolicy.version);
    expect(result.finalCapitalUsd).toBeGreaterThan(result.startingCapitalUsd);
  });

  it("records a blocked signal when Shariah screening rejects the method", () => {
    const result = runPaperTrading(
      {
        symbol: "TEST",
        startingCapitalUsd: 100,
        tradeAmountUsd: 10,
        stopLossPercent: 2,
        takeProfitPercent: 4,
        riskConfig,
        shariahPolicy,
      },
      [tick({ shariah: { ...tick().shariah, tradingMethod: "MARGIN" } })],
    );

    expect(result.trades).toHaveLength(0);
    expect(result.blockedSignals[0]?.reasons).toContain("SHARIAH_REJECTED");
  });

  it("rejects invalid simulation input", () => {
    expect(() => runPaperTrading({
      symbol: "TEST",
      startingCapitalUsd: 100,
      tradeAmountUsd: 101,
      stopLossPercent: 2,
      takeProfitPercent: 4,
      riskConfig,
      shariahPolicy,
    }, [tick()])).toThrow("INVALID_PAPER_TRADING_CONFIG");
  });

  it("rejects invalid timestamps and non-monotonic tick order", () => {
    expect(() => runPaperTrading(
      {
        symbol: "TEST",
        startingCapitalUsd: 100,
        tradeAmountUsd: 10,
        stopLossPercent: 2,
        takeProfitPercent: 4,
        riskConfig,
        shariahPolicy,
      },
      [tick({ timestamp: "not-a-date" })],
    )).toThrow("INVALID_PAPER_TRADING_TICK");

    expect(() => runPaperTrading(
      {
        symbol: "TEST",
        startingCapitalUsd: 100,
        tradeAmountUsd: 10,
        stopLossPercent: 2,
        takeProfitPercent: 4,
        riskConfig,
        shariahPolicy,
      },
      [
        tick({ timestamp: "2026-01-01T00:05:00Z" }),
        tick({ timestamp: "2026-01-01T00:05:00Z" }),
      ],
    )).toThrow("INVALID_PAPER_TRADING_TIMESTAMP_ORDER");
  });
});
