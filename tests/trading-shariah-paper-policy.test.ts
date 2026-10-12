import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHARIAH_POLICY,
  PAPER_SIMULATION_SHARIAH_POLICY,
  OWNER_SPOT_POLICY,
  applyPolicyReviewGate,
  evaluateShariah,
  QUALIFIED_SHARIAH_REVIEW_SOURCE,
} from '../lib/trading/shariah';

const spot = {
  symbol: 'BTC/USDT',
  assetType: 'DIGITAL_ASSET',
  businessActivity: 'spot digital asset',
  tradingMethod: 'SPOT' as const,
  ownershipSettlementVerified: true,
};

describe('paper simulation Shariah policy', () => {
  it('approves verified spot DIGITAL_ASSET in simulation only', () => {
    expect(evaluateShariah(spot, PAPER_SIMULATION_SHARIAH_POLICY).status).toBe('APPROVED');
  });
  it('still requires ownership/settlement verification', () => {
    expect(evaluateShariah({ ...spot, ownershipSettlementVerified: false }, PAPER_SIMULATION_SHARIAH_POLICY).status).toBe('REVIEW');
  });
  it('still rejects margin/futures', () => {
    expect(evaluateShariah({ ...spot, tradingMethod: 'FUTURES' }, PAPER_SIMULATION_SHARIAH_POLICY).status).toBe('REJECTED');
  });
  it('keeps the default (live) policy fail-closed', () => {
    expect(evaluateShariah(spot, DEFAULT_SHARIAH_POLICY).status).toBe('REVIEW');
  });
});

describe('owner spot live policy', () => {
  const qualifiedReviewed = {
    status: 'ACTIVE' as const,
    reviewedAt: new Date(),
    source: QUALIFIED_SHARIAH_REVIEW_SOURCE,
  };
  it('approves verified spot DIGITAL_ASSET only with active, dated qualified review provenance', () => {
    const raw = evaluateShariah(spot, OWNER_SPOT_POLICY);
    expect(raw.status).toBe('APPROVED');
    expect(applyPolicyReviewGate(raw, qualifiedReviewed).status).toBe('APPROVED');
    expect(applyPolicyReviewGate(raw, { status: 'INACTIVE', reviewedAt: null, source: QUALIFIED_SHARIAH_REVIEW_SOURCE }).status).toBe('REVIEW');
    expect(applyPolicyReviewGate(raw, null).status).toBe('REVIEW');
  });
  it('rejects owner self-review as insufficient authorization for real-money trading', () => {
    const raw = evaluateShariah(spot, OWNER_SPOT_POLICY);
    const decision = applyPolicyReviewGate(raw, {
      status: 'ACTIVE',
      reviewedAt: new Date(),
      source: 'OWNER_SELF_REVIEW',
    });
    expect(decision.status).toBe('REVIEW');
    expect(decision.reasons).toContain('POLICY_QUALIFIED_REVIEW_REQUIRED');
  });
  it('still blocks unverified ownership and futures', () => {
    expect(evaluateShariah({ ...spot, ownershipSettlementVerified: false }, OWNER_SPOT_POLICY).status).toBe('REVIEW');
    expect(evaluateShariah({ ...spot, tradingMethod: 'FUTURES' }, OWNER_SPOT_POLICY).status).toBe('REJECTED');
  });
});
