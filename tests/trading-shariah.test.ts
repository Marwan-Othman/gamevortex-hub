import { describe, expect, it } from 'vitest';
import { assertShariahApproved, DEFAULT_SHARIAH_POLICY, evaluateShariah, type ShariahPolicy } from '../lib/trading/shariah';

const policy: ShariahPolicy = {
  version: 'v-test',
  prohibitedBusinessKeywords: ['casino', 'alcohol'],
  prohibitedMethods: ['MARGIN', 'LEVERAGED', 'SHORT', 'FUTURES', 'OPTIONS', 'UNKNOWN'],
  maxInterestBearingDebtRatio: 0.33,
  maxInterestIncomeRatio: 0.05,
  maxImpermissibleIncomeRatio: 0.05,
};

const approvedInput = {
  symbol: 'TEST',
  assetType: 'STOCK',
  businessActivity: 'software',
  financialRatios: {
    interestBearingDebtRatio: 0.2,
    interestIncomeRatio: 0.01,
    impermissibleIncomeRatio: 0.01,
  },
  tradingMethod: 'SPOT' as const,
  ownershipSettlementVerified: true,
};

describe('Shariah Guard', () => {
  it('approves only when all required checks pass', () => {
    const result = evaluateShariah(approvedInput, policy);
    expect(result.status).toBe('APPROVED');
    expect(result.policyVersion).toBe('v-test');
    expect(result.reasons).toEqual([]);
  });

  it('rejects prohibited business activity', () => {
    const result = evaluateShariah({ ...approvedInput, businessActivity: 'casino software' }, policy);
    expect(result.status).toBe('REJECTED');
    expect(result.reasons.some((x) => x.startsWith('PROHIBITED_BUSINESS:'))).toBe(true);
  });

  it('rejects prohibited trading methods', () => {
    const result = evaluateShariah({ ...approvedInput, tradingMethod: 'MARGIN' }, policy);
    expect(result.status).toBe('REJECTED');
  });

  it('fails closed when the production financial-screening policy is not configured', () => {
    const result = evaluateShariah(approvedInput, DEFAULT_SHARIAH_POLICY);
    expect(result.status).toBe('REVIEW');
    expect(result.reasons).toContain('FINANCIAL_SCREENING_POLICY_NOT_CONFIGURED');
  });

  it('returns REVIEW when required financial data is missing', () => {
    const result = evaluateShariah({ ...approvedInput, financialRatios: undefined }, policy);
    expect(result.status).toBe('REVIEW');
  });

  it('returns REVIEW when ownership/settlement is not verified', () => {
    const result = evaluateShariah({ ...approvedInput, ownershipSettlementVerified: false }, policy);
    expect(result.status).toBe('REVIEW');
  });

  it('never treats REVIEW as tradable', () => {
    const result = evaluateShariah({ ...approvedInput, ownershipSettlementVerified: false }, policy);
    expect(() => assertShariahApproved(result)).toThrow('SHARIAH_REVIEW');
  });

  it('returns REVIEW (never APPROVED) when business activity is missing or empty', () => {
    for (const businessActivity of [undefined, '', '   ']) {
      const result = evaluateShariah({ ...approvedInput, businessActivity }, policy);
      expect(result.status).toBe('REVIEW');
      expect(result.reasons).toContain('BUSINESS_ACTIVITY_UNKNOWN');
    }
  });

  it('never approves a trading method outside the allowlist', () => {
    const result = evaluateShariah({ ...approvedInput, tradingMethod: 'CFD' as never }, policy);
    expect(result.status).toBe('REVIEW');
    expect(result.reasons).toContain('TRADING_METHOD_NOT_ALLOWED:CFD');
  });

  it('screens Arabic prohibited-business keywords in the default policy', () => {
    const result = evaluateShariah({ ...approvedInput, businessActivity: 'شركة كازينو' }, DEFAULT_SHARIAH_POLICY);
    expect(result.status).toBe('REJECTED');
  });
});
