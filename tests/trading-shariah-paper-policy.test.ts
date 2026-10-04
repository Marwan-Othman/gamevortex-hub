import { describe, expect, it } from 'vitest';
import { DEFAULT_SHARIAH_POLICY, PAPER_SIMULATION_SHARIAH_POLICY, evaluateShariah } from '../lib/trading/shariah';

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

import { OWNER_SPOT_POLICY, applyPolicyReviewGate } from '../lib/trading/shariah';

describe('owner spot live policy', () => {
  const reviewed = { status: 'ACTIVE' as const, reviewedAt: new Date() };
  it('approves verified spot DIGITAL_ASSET only once the policy row is ACTIVE and reviewed', () => {
    const raw = evaluateShariah(spot, OWNER_SPOT_POLICY);
    expect(raw.status).toBe('APPROVED');
    expect(applyPolicyReviewGate(raw, reviewed).status).toBe('APPROVED');
    expect(applyPolicyReviewGate(raw, { status: 'INACTIVE', reviewedAt: null }).status).toBe('REVIEW');
    expect(applyPolicyReviewGate(raw, null).status).toBe('REVIEW');
  });
  it('still blocks unverified ownership and futures', () => {
    expect(evaluateShariah({ ...spot, ownershipSettlementVerified: false }, OWNER_SPOT_POLICY).status).toBe('REVIEW');
    expect(evaluateShariah({ ...spot, tradingMethod: 'FUTURES' }, OWNER_SPOT_POLICY).status).toBe('REJECTED');
  });
});
