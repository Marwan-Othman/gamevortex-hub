import { describe, expect, it } from 'vitest';
import { parseRiskConfigInput } from '../lib/trading/risk-config';
import { evaluateRisk } from '../lib/trading/risk';

const valid = {
  maxTradeAmountUsd: 10,
  maxDailyLossUsd: 5,
  maxOpenTrades: 2,
  maxExposureUsd: 20,
  maxExposurePerAssetUsd: 10,
  maxConsecutiveLosses: 3,
};

function code(fn: () => unknown): { message: string; field?: string } {
  try {
    fn();
  } catch (e) {
    return { message: (e as Error).message, field: (e as { field?: string }).field };
  }
  return { message: 'NO_ERROR' };
}

describe('parseRiskConfigInput', () => {
  it('accepts a valid config and applies safe defaults', () => {
    const config = parseRiskConfigInput(valid);
    expect(config.requireStopLoss).toBe(true);
    expect(config.requireTakeProfit).toBe(false);
    expect(config.maxTradeAmountUsd).toBe(10);
  });

  it('rejects strings instead of numbers', () => {
    expect(code(() => parseRiskConfigInput({ ...valid, maxTradeAmountUsd: '10' }))).toEqual({
      message: 'INVALID_RISK_CONFIG',
      field: 'maxTradeAmountUsd',
    });
  });

  it('rejects NaN, Infinity, negatives and missing fields', () => {
    expect(code(() => parseRiskConfigInput({ ...valid, maxDailyLossUsd: NaN })).message).toBe('INVALID_RISK_CONFIG');
    expect(code(() => parseRiskConfigInput({ ...valid, maxExposureUsd: Infinity })).message).toBe('INVALID_RISK_CONFIG');
    expect(code(() => parseRiskConfigInput({ ...valid, maxDailyLossUsd: -1 })).field).toBe('maxDailyLossUsd');
    const { maxOpenTrades: _omit, ...missing } = valid;
    expect(code(() => parseRiskConfigInput(missing)).field).toBe('maxOpenTrades');
  });

  it('enforces the $1 minimum trade amount', () => {
    expect(code(() => parseRiskConfigInput({ ...valid, maxTradeAmountUsd: 0.99 })).field).toBe('maxTradeAmountUsd');
    expect(parseRiskConfigInput({ ...valid, maxTradeAmountUsd: 1 }).maxTradeAmountUsd).toBe(1);
  });

  it('requires integer counts of at least 1', () => {
    expect(code(() => parseRiskConfigInput({ ...valid, maxOpenTrades: 0 })).field).toBe('maxOpenTrades');
    expect(code(() => parseRiskConfigInput({ ...valid, maxOpenTrades: 1.5 })).field).toBe('maxOpenTrades');
    expect(code(() => parseRiskConfigInput({ ...valid, maxConsecutiveLosses: 0 })).field).toBe('maxConsecutiveLosses');
  });

  it('does not let per-asset exposure exceed total exposure', () => {
    expect(code(() => parseRiskConfigInput({ ...valid, maxExposurePerAssetUsd: 21 })).field).toBe('maxExposurePerAssetUsd');
    expect(parseRiskConfigInput({ ...valid, maxExposurePerAssetUsd: 20 }).maxExposurePerAssetUsd).toBe(20);
  });

  it('rejects non-boolean flags and non-object input', () => {
    expect(code(() => parseRiskConfigInput({ ...valid, requireStopLoss: 'yes' })).field).toBe('requireStopLoss');
    expect(code(() => parseRiskConfigInput(null)).message).toBe('INVALID_RISK_CONFIG');
    expect(code(() => parseRiskConfigInput([])).message).toBe('INVALID_RISK_CONFIG');
    expect(code(() => parseRiskConfigInput('x')).message).toBe('INVALID_RISK_CONFIG');
  });

  it('allows maxDailyLossUsd = 0 and that means no trading at all', () => {
    const config = parseRiskConfigInput({ ...valid, maxDailyLossUsd: 0 });
    const decision = evaluateRisk(config, {
      requestedAmountUsd: 5,
      dailyLossUsd: 0,
      openTrades: 0,
      totalExposureUsd: 0,
      assetExposureUsd: 0,
      consecutiveLosses: 0,
      hasStopLoss: true,
      hasTakeProfit: true,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reasons).toContain('MAX_DAILY_LOSS_REACHED');
  });
});
