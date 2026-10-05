import { describe, expect, it } from 'vitest';
import {
  VIP_PLANS,
  addMonthsUtc,
  computeVipEndsAt,
  formatUsdCents,
  getPurchasableVipPlan,
  getVipPlan,
  listPurchasableVipPlans,
  toPublicVipPlan,
} from '../lib/vip-plans';

describe('VIP plan catalog', () => {
  it('has the exact prices and durations from the spec', () => {
    const byCode = Object.fromEntries(VIP_PLANS.map((plan) => [plan.code, plan]));

    expect(byCode.FREE.priceCents).toBe(0);
    expect(byCode.VIP_1M.priceCents).toBe(499);
    expect(byCode.VIP_1M.gvcGrant).toBe(500);
    expect(byCode.VIP_1M.durationMonths).toBe(1);
    expect(byCode.VIP_3M.priceCents).toBe(1299);
    expect(byCode.VIP_3M.gvcGrant).toBe(1800);
    expect(byCode.VIP_3M.durationMonths).toBe(3);
    expect(byCode.VIP_6M.priceCents).toBe(1999);
    expect(byCode.VIP_6M.gvcGrant).toBe(4000);
    expect(byCode.VIP_6M.durationMonths).toBe(6);
    expect(byCode.VIP_1Y.priceCents).toBe(4999);
    expect(byCode.VIP_1Y.gvcGrant).toBe(10000);
    expect(byCode.VIP_1Y.durationMonths).toBe(12);
    expect(byCode.OWNER.priceCents).toBe(0);
    expect(byCode.OWNER.durationMonths).toBeNull();
  });

  it('only the four paid plans are purchasable', () => {
    expect(listPurchasableVipPlans().map((plan) => plan.code)).toEqual([
      'VIP_1M',
      'VIP_3M',
      'VIP_6M',
      'VIP_1Y',
    ]);
    expect(getPurchasableVipPlan('FREE')).toBeNull();
    expect(getPurchasableVipPlan('OWNER')).toBeNull();
    expect(getPurchasableVipPlan('VIP_1Y')?.priceCents).toBe(4999);
  });

  it('rejects unknown, malformed and non-string plan codes', () => {
    expect(getVipPlan('VIP_2M')).toBeNull();
    expect(getVipPlan('vip_1m')).toBeNull();
    expect(getVipPlan('__proto__')).toBeNull();
    expect(getVipPlan('constructor')).toBeNull();
    expect(getVipPlan(undefined)).toBeNull();
    expect(getVipPlan(null)).toBeNull();
    expect(getVipPlan(5)).toBeNull();
    expect(getVipPlan({ code: 'VIP_1M' })).toBeNull();
  });
});

describe('addMonthsUtc / computeVipEndsAt', () => {
  it('adds calendar months', () => {
    const start = new Date('2026-09-21T10:30:00.000Z');
    expect(addMonthsUtc(start, 1).toISOString()).toBe('2026-10-21T10:30:00.000Z');
    expect(addMonthsUtc(start, 3).toISOString()).toBe('2026-12-21T10:30:00.000Z');
    expect(addMonthsUtc(start, 6).toISOString()).toBe('2027-03-21T10:30:00.000Z');
    expect(addMonthsUtc(start, 12).toISOString()).toBe('2027-09-21T10:30:00.000Z');
  });

  it('clamps to the last day of shorter months', () => {
    expect(addMonthsUtc(new Date('2026-01-31T00:00:00.000Z'), 1).toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(addMonthsUtc(new Date('2028-01-31T00:00:00.000Z'), 1).toISOString()).toBe('2028-02-29T00:00:00.000Z');
    expect(addMonthsUtc(new Date('2026-11-30T00:00:00.000Z'), 3).toISOString()).toBe('2027-02-28T00:00:00.000Z');
  });

  it('does not mutate the input date', () => {
    const start = new Date('2026-09-21T10:30:00.000Z');
    addMonthsUtc(start, 6);
    expect(start.toISOString()).toBe('2026-09-21T10:30:00.000Z');
  });

  it('rejects invalid input', () => {
    expect(() => addMonthsUtc(new Date('invalid'), 1)).toThrow('INVALID_START_DATE');
    expect(() => addMonthsUtc(new Date(), 0)).toThrow('INVALID_MONTHS');
    expect(() => addMonthsUtc(new Date(), -1)).toThrow('INVALID_MONTHS');
    expect(() => addMonthsUtc(new Date(), 1.5)).toThrow('INVALID_MONTHS');
  });

  it('computes the end date per plan and returns null for Free/Owner', () => {
    const start = new Date('2026-09-21T00:00:00.000Z');
    expect(computeVipEndsAt(start, getVipPlan('VIP_1Y')!)?.toISOString()).toBe('2027-09-21T00:00:00.000Z');
    expect(computeVipEndsAt(start, getVipPlan('FREE')!)).toBeNull();
    expect(computeVipEndsAt(start, getVipPlan('OWNER')!)).toBeNull();
  });
});

describe('formatUsdCents / toPublicVipPlan', () => {
  it('formats cents with integer math', () => {
    expect(formatUsdCents(0)).toBe('$0.00');
    expect(formatUsdCents(5)).toBe('$0.05');
    expect(formatUsdCents(299)).toBe('$2.99');
    expect(formatUsdCents(749)).toBe('$7.49');
    expect(formatUsdCents(1999)).toBe('$19.99');
    expect(formatUsdCents(4999)).toBe('$49.99');
    expect(() => formatUsdCents(-1)).toThrow('INVALID_CENTS');
    expect(() => formatUsdCents(1.5)).toThrow('INVALID_CENTS');
  });

  it('exposes only public fields', () => {
    const publicPlan = toPublicVipPlan(getVipPlan('VIP_3M')!);
    expect(publicPlan).toEqual({
      code: 'VIP_3M',
      kind: 'PAID',
      emoji: '💎',
      nameAr: 'VIP 3 أشهر',
      nameEn: 'VIP 3 Months',
      priceCents: 1299,
      priceLabel: '$12.99',
      currency: 'USD',
      durationMonths: 3,
      purchasable: true,
      pointsMultiplier: 1.5,
      gvcGrant: 1800,
    });
  });
});
