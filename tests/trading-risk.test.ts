import { describe, expect, it } from 'vitest';
import { evaluateRisk, validateRiskConfig, type RiskConfig } from '../lib/trading/risk';

const config: RiskConfig = {
  maxTradeAmountUsd: 100,
  maxDailyLossUsd: 50,
  maxOpenTrades: 3,
  maxExposureUsd: 200,
  maxExposurePerAssetUsd: 100,
  maxConsecutiveLosses: 3,
  requireStopLoss: true,
  requireTakeProfit: false,
};

const base = {
  requestedAmountUsd: 10,
  dailyLossUsd: 0,
  openTrades: 0,
  totalExposureUsd: 0,
  assetExposureUsd: 0,
  consecutiveLosses: 0,
  hasStopLoss: true,
  hasTakeProfit: false,
};

describe('Risk Manager', () => {
  it('allows a valid trade', () => {
    expect(evaluateRisk(config, base)).toEqual({ allowed: true, reasons: [] });
  });

  it('blocks a trade above the maximum trade amount', () => {
    const result = evaluateRisk(config, { ...base, requestedAmountUsd: 101 });
    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain('MAX_TRADE_AMOUNT_EXCEEDED');
  });

  it('blocks when daily loss limit is reached', () => {
    const result = evaluateRisk(config, { ...base, dailyLossUsd: 50 });
    expect(result.reasons).toContain('MAX_DAILY_LOSS_REACHED');
  });

  it('blocks when open-trade limit is reached', () => {
    const result = evaluateRisk(config, { ...base, openTrades: 3 });
    expect(result.reasons).toContain('MAX_OPEN_TRADES_REACHED');
  });

  it('blocks exposure beyond the total or per-asset limit', () => {
    const result = evaluateRisk(config, {
      ...base,
      requestedAmountUsd: 20,
      totalExposureUsd: 190,
      assetExposureUsd: 90,
    });
    expect(result.reasons).toContain('MAX_EXPOSURE_EXCEEDED');
    expect(result.reasons).toContain('MAX_ASSET_EXPOSURE_EXCEEDED');
  });

  it('blocks consecutive-loss limit and missing stop loss', () => {
    const result = evaluateRisk(config, { ...base, consecutiveLosses: 3, hasStopLoss: false });
    expect(result.reasons).toContain('MAX_CONSECUTIVE_LOSSES_REACHED');
    expect(result.reasons).toContain('STOP_LOSS_REQUIRED');
  });

  it('blocks any circuit breaker reason', () => {
    const result = evaluateRisk(config, { ...base, circuitBreakerReasons: ['API_ERROR'] });
    expect(result.reasons).toContain('CIRCUIT_BREAKER:API_ERROR');
  });

  it('rejects unsafe risk configuration', () => {
    expect(() => validateRiskConfig({ ...config, maxTradeAmountUsd: 0 })).toThrow('INVALID_RISK_CONFIG');
    expect(() => validateRiskConfig({ ...config, maxOpenTrades: 0 })).toThrow('INVALID_RISK_CONFIG');
  });
});
