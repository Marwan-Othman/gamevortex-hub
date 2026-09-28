import { describe, expect, it } from 'vitest';
import {
  allocationPoints,
  tradingMaxAllocationUsd,
  validateAllocationUsd,
  validateIdempotencyKey,
} from '../lib/trading/money';

describe('validateAllocationUsd', () => {
  it('accepts the owner example amounts', () => {
    for (const v of [1, 5, 10, 50, 100]) expect(validateAllocationUsd(v, 1000)).toBe(v);
  });

  it('rejects below the $1 minimum, zero and negative amounts', () => {
    expect(() => validateAllocationUsd(0, 1000)).toThrow('ALLOCATION_BELOW_MINIMUM');
    expect(() => validateAllocationUsd(-5, 1000)).toThrow('ALLOCATION_BELOW_MINIMUM');
  });

  it('rejects fractions, NaN, Infinity and non-numbers', () => {
    expect(() => validateAllocationUsd(1.5, 1000)).toThrow('ALLOCATION_MUST_BE_WHOLE_USD');
    expect(() => validateAllocationUsd(NaN, 1000)).toThrow('INVALID_ALLOCATION_AMOUNT');
    expect(() => validateAllocationUsd(Infinity, 1000)).toThrow('INVALID_ALLOCATION_AMOUNT');
    expect(() => validateAllocationUsd('10', 1000)).toThrow('INVALID_ALLOCATION_AMOUNT');
    expect(() => validateAllocationUsd(undefined, 1000)).toThrow('INVALID_ALLOCATION_AMOUNT');
  });

  it('rejects amounts above the configured maximum', () => {
    expect(() => validateAllocationUsd(1001, 1000)).toThrow('ALLOCATION_ABOVE_MAXIMUM');
  });
});

describe('tradingMaxAllocationUsd', () => {
  it('falls back to the default on bad env values', () => {
    expect(tradingMaxAllocationUsd(undefined)).toBe(1000);
    expect(tradingMaxAllocationUsd('abc')).toBe(1000);
    expect(tradingMaxAllocationUsd('0')).toBe(1000);
    expect(tradingMaxAllocationUsd('2500')).toBe(2500);
  });
});

describe('allocationPoints', () => {
  it('converts whole USD to points exactly', () => {
    expect(allocationPoints(1, 30)).toBe(30);
    expect(allocationPoints(100, 30)).toBe(3000);
  });

  it('rejects an invalid conversion rate', () => {
    expect(() => allocationPoints(1, 0)).toThrow('INVALID_CONVERSION_RATE');
  });
});

describe('validateIdempotencyKey', () => {
  it('accepts a UUID and rejects empty, short or unsafe keys', () => {
    expect(validateIdempotencyKey('3f1c2a7e-9d1b-4c55-8f2a-0b7d5e6c1a90')).toBeTruthy();
    expect(() => validateIdempotencyKey('')).toThrow('IDEMPOTENCY_KEY_REQUIRED');
    expect(() => validateIdempotencyKey('short')).toThrow('IDEMPOTENCY_KEY_REQUIRED');
    expect(() => validateIdempotencyKey('bad key with spaces')).toThrow('IDEMPOTENCY_KEY_REQUIRED');
    expect(() => validateIdempotencyKey(123)).toThrow('IDEMPOTENCY_KEY_REQUIRED');
  });
});
