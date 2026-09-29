import { describe, expect, it } from 'vitest';
import { parseShariahInput } from '../lib/trading/shariah-input';
import { evaluateShariah } from '../lib/trading/shariah';

const base = {
  symbol: ' aapl ',
  assetType: 'stock',
  businessActivity: 'software',
  tradingMethod: 'SPOT',
  ownershipSettlementVerified: true,
};

function err(fn: () => unknown): { message: string; field?: string } {
  try {
    fn();
  } catch (e) {
    return { message: (e as Error).message, field: (e as { field?: string }).field };
  }
  return { message: 'NO_ERROR' };
}

describe('parseShariahInput', () => {
  it('normalises symbol and asset type', () => {
    const parsed = parseShariahInput(base);
    expect(parsed.symbol).toBe('AAPL');
    expect(parsed.assetType).toBe('STOCK');
    expect(parsed.tradingMethod).toBe('SPOT');
  });

  it('turns an unknown or missing trading method into UNKNOWN (prohibited)', () => {
    expect(parseShariahInput({ ...base, tradingMethod: 'CFD' }).tradingMethod).toBe('UNKNOWN');
    expect(parseShariahInput({ ...base, tradingMethod: 123 }).tradingMethod).toBe('UNKNOWN');
    const { tradingMethod: _omit, ...noMethod } = base;
    const parsed = parseShariahInput(noMethod);
    expect(parsed.tradingMethod).toBe('UNKNOWN');
    expect(evaluateShariah(parsed).status).toBe('REJECTED');
  });

  it('accepts lower-case known methods', () => {
    expect(parseShariahInput({ ...base, tradingMethod: 'margin' }).tradingMethod).toBe('MARGIN');
  });

  it('counts ownership/settlement as verified only for boolean true', () => {
    expect(parseShariahInput({ ...base, ownershipSettlementVerified: 'true' }).ownershipSettlementVerified).toBe(false);
    expect(parseShariahInput({ ...base, ownershipSettlementVerified: 1 }).ownershipSettlementVerified).toBe(false);
    expect(parseShariahInput({ ...base, ownershipSettlementVerified: undefined }).ownershipSettlementVerified).toBe(false);
    expect(parseShariahInput(base).ownershipSettlementVerified).toBe(true);
  });

  it('rejects missing identity fields', () => {
    expect(err(() => parseShariahInput({ ...base, symbol: '   ' })).field).toBe('symbol');
    expect(err(() => parseShariahInput({ ...base, assetType: undefined })).field).toBe('assetType');
    expect(err(() => parseShariahInput({ ...base, symbol: 5 })).message).toBe('INVALID_SHARIAH_INPUT');
  });

  it('rejects oversized text and non-object input', () => {
    expect(err(() => parseShariahInput({ ...base, businessActivity: 'x'.repeat(501) })).field).toBe('businessActivity');
    expect(err(() => parseShariahInput(null)).message).toBe('INVALID_SHARIAH_INPUT');
    expect(err(() => parseShariahInput([])).message).toBe('INVALID_SHARIAH_INPUT');
  });

  it('accepts real numeric ratios and rejects strings, negatives, NaN', () => {
    const ok = parseShariahInput({ ...base, financialRatios: { interestIncomeRatio: 0.02 } });
    expect(ok.financialRatios).toEqual({ interestIncomeRatio: 0.02 });
    expect(err(() => parseShariahInput({ ...base, financialRatios: { interestIncomeRatio: '0.02' } })).field).toBe(
      'financialRatios.interestIncomeRatio',
    );
    expect(err(() => parseShariahInput({ ...base, financialRatios: { interestIncomeRatio: -1 } })).message).toBe(
      'INVALID_SHARIAH_INPUT',
    );
    expect(err(() => parseShariahInput({ ...base, financialRatios: { impermissibleIncomeRatio: NaN } })).message).toBe(
      'INVALID_SHARIAH_INPUT',
    );
    expect(err(() => parseShariahInput({ ...base, financialRatios: 'x' })).field).toBe('financialRatios');
  });

  it('ignores unknown ratio keys', () => {
    const parsed = parseShariahInput({ ...base, financialRatios: { foo: 1, interestIncomeRatio: 0.01 } });
    expect(parsed.financialRatios).toEqual({ interestIncomeRatio: 0.01 });
  });
});
