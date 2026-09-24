import { afterEach, describe, expect, it } from 'vitest';
import { OWNER_MIN_WITHDRAW_POINTS, OWNER_POINTS_PER_USD, pointsToUsd, validateOwnerWithdrawal } from '../lib/owner-points';

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
});
