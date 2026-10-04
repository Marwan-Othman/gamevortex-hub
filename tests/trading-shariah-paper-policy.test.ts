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
