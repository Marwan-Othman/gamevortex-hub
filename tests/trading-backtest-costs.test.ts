import { describe, expect, it } from 'vitest';
import { runBacktest } from '../lib/trading/backtest';
import { runSweep } from '../lib/trading/backtest-sweep';

const mk = (i: number, close: number, high = close * 1.001) => ({
  timestamp: new Date(Date.UTC(2026, 9, 1, 10, i * 5)).toISOString(),
  open: close, high, low: close * 0.999, close,
  volume: 1000, fastAverage: close - 1, slowAverage: close - 2, averageVolume: 900,
});
const base = { initialCapitalUsd: 100, tradeAmountUsd: 10, stopLossPercent: 2, takeProfitPercent: 4 };
const series = [mk(0, 100), mk(1, 101), mk(2, 104, 105)];

describe('backtest costs', () => {
  it('fees and slippage reduce profit', () => {
    const free = runBacktest('BTC/USDT', series, base);
    const costly = runBacktest('BTC/USDT', series, { ...base, feePercent: 0.1, slippagePercent: 0.05 });
    expect(costly.pnlUsd).toBeLessThan(free.pnlUsd);
    expect(costly.totalFeesUsd).toBeGreaterThan(0);
  });
  it('defaults to zero costs', () => {
    expect(runBacktest('BTC/USDT', series, base).totalFeesUsd).toBe(0);
  });
  it('rejects negative or huge costs', () => {
    expect(() => runBacktest('BTC/USDT', series, { ...base, feePercent: -1 })).toThrow('INVALID_BACKTEST_CONFIG');
    expect(() => runBacktest('BTC/USDT', series, { ...base, slippagePercent: 50 })).toThrow('INVALID_BACKTEST_CONFIG');
  });
});

describe('backtest sweep', () => {
  it('rejects too little data', () => {
    expect(() => runSweep('BTC/USDT', [], base)).toThrow('INVALID_BACKTEST_INPUT');
  });
  it('splits train/test and returns ranked rows', () => {
    let seed = 7;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    let price = 100;
    const raw = Array.from({ length: 800 }, (_, i) => {
      const o = price; const c = o * (1 + (rnd() - 0.5) * 0.01); price = c;
      return { timestamp: new Date(Date.UTC(2026, 5, 1, i)).toISOString(), open: o,
        high: Math.max(o, c) * 1.001, low: Math.min(o, c) * 0.999, close: c, volume: 10 + rnd() * 20 };
    });
    const result = runSweep('BTC/USDT', raw, base);
    expect(result.trainCandles).toBeGreaterThan(result.testCandles);
    expect(result.rows.length).toBeLessThanOrEqual(10);
    const trains = result.rows.map((r) => r.train.returnPercent);
    expect([...trains].sort((a, b) => b - a)).toEqual(trains);
  });
});
