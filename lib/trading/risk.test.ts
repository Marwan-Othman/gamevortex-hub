import { describe, expect, it } from "vitest";
import { evaluateRisk, validateRiskConfig, type RiskConfig } from "./risk";

const config: RiskConfig = {
  maxTradeAmountUsd: 25,
  maxDailyLossUsd: 10,
  maxOpenTrades: 2,
  maxExposureUsd: 40,
  maxExposurePerAssetUsd: 25,
  maxConsecutiveLosses: 3,
  requireStopLoss: true,
  requireTakeProfit: true,
};

describe("risk manager", () => {
  it("allows a valid trade inside every configured limit", () => {
    const decision = evaluateRisk(config, {
      requestedAmountUsd: 10,
      dailyLossUsd: 0,
      openTrades: 0,
      totalExposureUsd: 0,
      assetExposureUsd: 0,
      consecutiveLosses: 0,
      hasStopLoss: true,
      hasTakeProfit: true,
    });

    expect(decision).toEqual({ allowed: true, reasons: [] });
  });

  it("blocks every configured hard risk boundary", () => {
    const decision = evaluateRisk(config, {
      requestedAmountUsd: 26,
      dailyLossUsd: 10,
      openTrades: 2,
      totalExposureUsd: 35,
      assetExposureUsd: 20,
      consecutiveLosses: 3,
      hasStopLoss: false,
      hasTakeProfit: false,
      circuitBreakerReasons: ["EMERGENCY_STOP"],
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toEqual([
      "MAX_TRADE_AMOUNT_EXCEEDED",
      "MAX_DAILY_LOSS_REACHED",
      "MAX_OPEN_TRADES_REACHED",
      "MAX_EXPOSURE_EXCEEDED",
      "MAX_ASSET_EXPOSURE_EXCEEDED",
      "MAX_CONSECUTIVE_LOSSES_REACHED",
      "STOP_LOSS_REQUIRED",
      "TAKE_PROFIT_REQUIRED",
      "CIRCUIT_BREAKER:EMERGENCY_STOP",
    ]);
  });

  it("rejects malformed risk configuration", () => {
    expect(() => validateRiskConfig({ ...config, maxTradeAmountUsd: 0 })).toThrow("INVALID_RISK_CONFIG");
    expect(() => validateRiskConfig({ ...config, maxOpenTrades: 0 })).toThrow("INVALID_RISK_CONFIG");
    expect(() => validateRiskConfig({ ...config, maxConsecutiveLosses: 1.5 })).toThrow("INVALID_RISK_CONFIG");
  });

  it("blocks sub-dollar and malformed requested amounts", () => {
    const belowMinimum = evaluateRisk(config, {
      requestedAmountUsd: 0.99,
      dailyLossUsd: 0,
      openTrades: 0,
      totalExposureUsd: 0,
      assetExposureUsd: 0,
      consecutiveLosses: 0,
      hasStopLoss: true,
      hasTakeProfit: true,
    });
    expect(belowMinimum.reasons).toContain("INVALID_TRADE_AMOUNT");

    const malformed = evaluateRisk(config, {
      requestedAmountUsd: Number.NaN,
      dailyLossUsd: 0,
      openTrades: 0,
      totalExposureUsd: 0,
      assetExposureUsd: 0,
      consecutiveLosses: 0,
      hasStopLoss: true,
      hasTakeProfit: true,
    });
    expect(malformed.allowed).toBe(false);
    expect(malformed.reasons).toContain("INVALID_TRADE_AMOUNT");
  });
});
