import { describe, expect, it } from "vitest";
import { runPaperTrading } from "./paper-trading";
import type { RiskConfig } from "./risk";
import type { ShariahAssetInput, ShariahPolicy } from "./shariah";

const riskConfig: RiskConfig = {
  maxTradeAmountUsd: 10,
  maxDailyLossUsd: 20,
  maxOpenTrades: 1,
  maxExposureUsd: 10,
  maxExposurePerAssetUsd: 10,
  maxConsecutiveLosses: 3,
  requireStopLoss: true,
  requireTakeProfit: true,
};

const shariahPolicy: ShariahPolicy = {
  version: "test-v1",
  prohibitedBusinessKeywords: ["alcohol", "casino", "gambling"],
  prohibitedMethods: ["MARGIN", "LEVERAGED", "SHORT", "FUTURES", "OPTIONS", "UNKNOWN"],
  maxInterestBearingDebtRatio: 0.05,
  maxInterestIncomeRatio: 0.05,
  maxImpermissibleIncomeRatio: 0.05,
};

const shariah: ShariahAssetInput = {
  symbol: "TEST",
  assetType: "equity",
  businessActivity: "software",
  tradingMethod: "SPOT",
  ownershipSettlementVerified: true,
  financialRatios: {
    interestBearingDebtRatio: 0,
    interestIncomeRatio: 0,
    impermissibleIncomeRatio: 0,
  },
};

const tick = (overrides: Partial<Parameters<typeof runPaperTrading>[1][number]> = {}) => ({
  timestamp: "2026-01-01T00:00:00Z",
  price: 100,
  previousPrice: 99,
  fastAverage: 101,
  slowAverage: 99,
  volume: 1200,
  averageVolume: 1000,
  shariah,
  ...overrides,
});

describe("runPaperTrading", () => {
  it("opens and closes a simulated position without real-money side effects", () => {
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
        tick(),
        tick({
          timestamp: "2026-01-01T00:05:00Z",
          price: 104,
          previousPrice: 100,
        }),
      ],
    );

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].exitReason).toBe("TAKE_PROFIT");
    expect(result.trades[0].pnlUsd).toBeCloseTo(0.4, 8);
    expect(result.finalCapitalUsd).toBeCloseTo(100.4, 8);
  });

  it("blocks a candidate when Shariah status is not approved", () => {
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
        tick({
          shariah: {
            ...shariah,
            tradingMethod: "MARGIN",
          },
        }),
      ],
    );

    expect(result.trades).toHaveLength(0);
    expect(result.blockedSignals).toHaveLength(1);
    expect(result.blockedSignals[0].reasons).toContain("SHARIAH_REJECTED");
  });

  it("blocks a candidate when the risk limit is reached", () => {
    const result = runPaperTrading(
      {
        symbol: "TEST",
        startingCapitalUsd: 100,
        tradeAmountUsd: 10,
        stopLossPercent: 2,
        takeProfitPercent: 4,
        riskConfig: {
          ...riskConfig,
          maxTradeAmountUsd: 9,
        },
        shariahPolicy,
      },
      [tick()],
    );

    expect(result.trades).toHaveLength(0);
    expect(result.blockedSignals[0].reasons).toContain("MAX_TRADE_AMOUNT_EXCEEDED");
  });

  it("fails closed when Shariah financial screening data is missing", () => {
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
        tick({
          shariah: {
            ...shariah,
            financialRatios: undefined,
          },
        }),
      ],
    );

    expect(result.trades).toHaveLength(0);
    expect(result.blockedSignals[0].reasons).toContain("SHARIAH_REVIEW");
  });

  it("rejects invalid paper-trading input", () => {
    expect(() =>
      runPaperTrading(
        {
          symbol: "TEST",
          startingCapitalUsd: 100,
          tradeAmountUsd: 10,
          stopLossPercent: 2,
          takeProfitPercent: 4,
          riskConfig,
          shariahPolicy,
        },
        [],
      ),
    ).toThrow("INVALID_PAPER_TRADING_INPUT");
  });
});
