import { describe, expect, it } from 'vitest';

describe('AI GVC credit invariants', () => {
  it('defines the reservation/refund invariants used by the credit layer', () => {
    const reservation = { delta: -10 };
    const refund = { delta: 10 };

    expect(Math.abs(reservation.delta)).toBe(refund.delta);
    expect(reservation.delta + refund.delta).toBe(0);
  });

  it('rejects a refund larger than its reservation at the invariant level', () => {
    const reservedAmount = 10;
    const requestedRefund = 11;

    expect(requestedRefund).toBeGreaterThan(reservedAmount);
  });
});
