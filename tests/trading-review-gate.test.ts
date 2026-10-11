import { describe, expect, it } from 'vitest';
import {
  applyPolicyReviewGate,
  evaluateShariah,
  QUALIFIED_SHARIAH_REVIEW_SOURCE,
  type ShariahPolicy,
} from '../lib/trading/shariah';

const policy: ShariahPolicy = {
  version: 'v-test',
  prohibitedBusinessKeywords: ['casino'],
  prohibitedMethods: ['MARGIN', 'LEVERAGED', 'SHORT', 'FUTURES', 'OPTIONS', 'UNKNOWN'],
  maxInterestBearingDebtRatio: 0.33,
  maxInterestIncomeRatio: 0.05,
  maxImpermissibleIncomeRatio: 0.05,
};

const good = {
  symbol: 'TEST',
  assetType: 'STOCK',
  businessActivity: 'software',
  financialRatios: { interestBearingDebtRatio: 0.1, interestIncomeRatio: 0.01, impermissibleIncomeRatio: 0.01 },
  tradingMethod: 'SPOT' as const,
  ownershipSettlementVerified: true,
};

const reviewed = {
  status: 'ACTIVE' as const,
  reviewedAt: new Date('2026-01-01'),
  source: QUALIFIED_SHARIAH_REVIEW_SOURCE,
};

describe('applyPolicyReviewGate', () => {
  it('keeps APPROVED only for an ACTIVE policy with dated, qualified-review provenance', () => {
    const d = applyPolicyReviewGate(evaluateShariah(good, policy), reviewed);
    expect(d.status).toBe('APPROVED');
    expect(d.reasons).toEqual([]);
  });

  it('downgrades APPROVED to REVIEW when the policy is INACTIVE', () => {
    const d = applyPolicyReviewGate(evaluateShariah(good, policy), {
      status: 'INACTIVE',
      reviewedAt: new Date(),
      source: QUALIFIED_SHARIAH_REVIEW_SOURCE,
    });
    expect(d.status).toBe('REVIEW');
    expect(d.reasons).toContain('POLICY_NOT_REVIEWED_OR_NOT_ACTIVE');
  });

  it('downgrades APPROVED to REVIEW when the policy was never reviewed', () => {
    const d = applyPolicyReviewGate(evaluateShariah(good, policy), {
      status: 'ACTIVE',
      reviewedAt: null,
      source: QUALIFIED_SHARIAH_REVIEW_SOURCE,
    });
    expect(d.status).toBe('REVIEW');
    expect(d.reasons).toContain('POLICY_NOT_REVIEWED_OR_NOT_ACTIVE');
  });

  it('blocks owner self-review even if status is ACTIVE and reviewedAt is set', () => {
    const d = applyPolicyReviewGate(evaluateShariah(good, policy), {
      status: 'ACTIVE',
      reviewedAt: new Date('2026-01-01'),
      source: 'OWNER_SELF_REVIEW',
    });
    expect(d.status).toBe('REVIEW');
    expect(d.reasons).toContain('POLICY_QUALIFIED_REVIEW_REQUIRED');
  });

  it('fails closed when qualified-review provenance is missing or unrecognized', () => {
    expect(applyPolicyReviewGate(evaluateShariah(good, policy), {
      status: 'ACTIVE',
      reviewedAt: new Date(),
    }).reasons).toContain('POLICY_QUALIFIED_REVIEW_REQUIRED');
    expect(applyPolicyReviewGate(evaluateShariah(good, policy), {
      status: 'ACTIVE',
      reviewedAt: new Date(),
      source: 'INTERNAL_DRAFT',
    }).status).toBe('REVIEW');
    expect(applyPolicyReviewGate(evaluateShariah(good, policy), null).status).toBe('REVIEW');
    expect(applyPolicyReviewGate(evaluateShariah(good, policy), undefined).status).toBe('REVIEW');
  });

  it('never turns REJECTED into REVIEW', () => {
    const rejected = evaluateShariah({ ...good, businessActivity: 'casino' }, policy);
    expect(rejected.status).toBe('REJECTED');
    expect(applyPolicyReviewGate(rejected, {
      status: 'INACTIVE',
      reviewedAt: null,
      source: 'OWNER_SELF_REVIEW',
    }).status).toBe('REJECTED');
  });

  it('leaves REVIEW as REVIEW without adding noise', () => {
    const review = evaluateShariah({ ...good, businessActivity: '' }, policy);
    expect(review.status).toBe('REVIEW');
    const gated = applyPolicyReviewGate(review, {
      status: 'INACTIVE',
      reviewedAt: null,
      source: 'OWNER_SELF_REVIEW',
    });
    expect(gated.status).toBe('REVIEW');
    expect(gated.reasons).toEqual(review.reasons);
  });
});
