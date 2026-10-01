import { afterEach, describe, expect, it } from 'vitest';
import {
  OWNER_MIN_WITHDRAW_POINTS,
  OWNER_POINTS_PER_USD,
  calculateOwnerCashSummary,
  pointsToUsd,
  validateOwnerWithdrawalTransition,
  validateOwnerWithdrawal,
} from '../lib/owner-points';

const previousPerUsd = process.env.OWNER_POINTS_PER_USD;
const previousMinWithdraw = process.env.OWNER_MIN_WITHDRAW_POINTS;

afterEach(() => {
  if (previousPerUsd === undefined) delete process.env.OWNER_POINTS_PER_USD;
  else process.env.OWNER_POINTS_PER_USD = previousPerUsd;
  if (previousMinWithdraw === undefined) delete process.env.OWNER_MIN_WITHDRAW_POINTS;
  else process.env.OWNER_MIN_WITHDRAW_POINTS = previousMinWithdraw;
});

describe('pointsToUsd', () => {
  it('converts points to USD using the configured conversion rate', () => {
    expect(pointsToUsd(OWNER_POINTS_PER_USD)).toBe(1);
    expect(pointsToUsd(OWNER_POINTS_PER_USD * 2)).toBe(2);
  });
});

describe('validateOwnerWithdrawal', () => {
  it('accepts a withdrawal at exactly the minimum and returns the USD amount rounded to cents', () => {
    const usd = validateOwnerWithdrawal(OWNER_MIN_WITHDRAW_POINTS);
    expect(usd).toBe(Number((OWNER_MIN_WITHDRAW_POINTS / OWNER_POINTS_PER_USD).toFixed(2)));
  });

  it('accepts a withdrawal above the minimum', () => {
    expect(() => validateOwnerWithdrawal(OWNER_MIN_WITHDRAW_POINTS + 100)).not.toThrow();
  });

  it('rejects a withdrawal below the minimum points threshold', () => {
    expect(() => validateOwnerWithdrawal(OWNER_MIN_WITHDRAW_POINTS - 1)).toThrow('MINIMUM_WITHDRAWAL_NOT_MET');
  });

  it('rejects a non-integer points value (e.g. a client sending a float or NaN)', () => {
    expect(() => validateOwnerWithdrawal(OWNER_MIN_WITHDRAW_POINTS + 0.5)).toThrow('MINIMUM_WITHDRAWAL_NOT_MET');
    expect(() => validateOwnerWithdrawal(Number.NaN)).toThrow('MINIMUM_WITHDRAWAL_NOT_MET');
  });

  it('rejects a negative points value', () => {
    expect(() => validateOwnerWithdrawal(-50)).toThrow('MINIMUM_WITHDRAWAL_NOT_MET');
  });

  it('respects a custom conversion rate and minimum set via environment variables', () => {
    process.env.OWNER_POINTS_PER_USD = '10';
    process.env.OWNER_MIN_WITHDRAW_POINTS = '5';
    const customPerUsd = Number(process.env.OWNER_POINTS_PER_USD);
    const customMin = Number(process.env.OWNER_MIN_WITHDRAW_POINTS);
    expect(customPerUsd).toBe(10);
    expect(customMin).toBe(5);
  });

  it('keeps real cash distinct from points-based balances when summarizing owner finances', () => {
    const summary = calculateOwnerCashSummary({
      grossUsd: 1500,
      refundsUsd: 150,
      paidOutUsd: 500,
      pendingOutUsd: 200,
      availablePoints: 900,
      pendingPoints: 120,
    });

    expect(summary.netRevenueUsd).toBe(1350);
    expect(summary.cashAvailableUsd).toBe(650);
    expect(summary.pointsBalanceUsd).toBe(30);
    expect(summary.pendingPointsUsd).toBe(4);
  });

  it('allows only explicit payout transitions and reports whether reserved points are released', () => {
    expect(validateOwnerWithdrawalTransition('PROCESSING', 'PAID')).toEqual({
      releasesPoints: false,
      settlesPayout: true,
    });
    expect(validateOwnerWithdrawalTransition('PENDING', 'REJECTED')).toEqual({
      releasesPoints: true,
      settlesPayout: false,
    });
    expect(() => validateOwnerWithdrawalTransition('PAID', 'REVERSED')).toThrow('WITHDRAWAL_ALREADY_FINAL');
    expect(() => validateOwnerWithdrawalTransition('REQUESTED', 'SETTLED')).not.toThrow();
  });
});
