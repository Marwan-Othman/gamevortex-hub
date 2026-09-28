import { describe, expect, it } from 'vitest';
import {
  CIRCUIT_BREAKER_REASONS,
  controlBlockReasons,
  isCircuitBreakerReason,
  isTradingBlocked,
} from '../lib/trading/control';

describe('trading control (Emergency Stop / Circuit Breaker)', () => {
  it('allows trading only when not stopped and no breaker is active', () => {
    const state = { emergencyStopped: false, circuitBreakerReasons: [] };
    expect(controlBlockReasons(state)).toEqual([]);
    expect(isTradingBlocked(state)).toBe(false);
  });

  it('blocks on emergency stop', () => {
    const state = { emergencyStopped: true, circuitBreakerReasons: [] };
    expect(controlBlockReasons(state)).toEqual(['EMERGENCY_STOP_ACTIVE']);
    expect(isTradingBlocked(state)).toBe(true);
  });

  it('blocks on any circuit breaker reason, including unknown ones', () => {
    expect(controlBlockReasons({ emergencyStopped: false, circuitBreakerReasons: ['API_ERROR'] })).toEqual([
      'CIRCUIT_BREAKER:API_ERROR',
    ]);
    expect(isTradingBlocked({ emergencyStopped: false, circuitBreakerReasons: ['SOMETHING_NEW'] })).toBe(true);
  });

  it('reports every active reason', () => {
    const reasons = controlBlockReasons({ emergencyStopped: true, circuitBreakerReasons: ['ORDER_FAILURE', 'PRICE_ANOMALY'] });
    expect(reasons).toEqual(['EMERGENCY_STOP_ACTIVE', 'CIRCUIT_BREAKER:ORDER_FAILURE', 'CIRCUIT_BREAKER:PRICE_ANOMALY']);
  });

  it('fails closed when the control state is missing', () => {
    expect(controlBlockReasons(null)).toEqual(['TRADING_CONTROL_MISSING']);
    expect(controlBlockReasons(undefined)).toEqual(['TRADING_CONTROL_MISSING']);
    expect(isTradingBlocked(null)).toBe(true);
  });

  it('fails closed on malformed state', () => {
    // @ts-expect-error deliberately malformed
    expect(isTradingBlocked({ emergencyStopped: undefined, circuitBreakerReasons: [] })).toBe(true);
    // @ts-expect-error deliberately malformed
    expect(isTradingBlocked({ emergencyStopped: false, circuitBreakerReasons: undefined })).toBe(true);
  });

  it('knows exactly the seven circuit breaker reasons', () => {
    expect(CIRCUIT_BREAKER_REASONS).toHaveLength(7);
    expect(isCircuitBreakerReason('API_ERROR')).toBe(true);
    expect(isCircuitBreakerReason('UNEXPECTED_SYSTEM_ERROR')).toBe(true);
    expect(isCircuitBreakerReason('api_error')).toBe(false);
    expect(isCircuitBreakerReason('MANUAL')).toBe(false);
    expect(isCircuitBreakerReason(42)).toBe(false);
  });
});
