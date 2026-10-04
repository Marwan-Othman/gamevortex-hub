import { describe, expect, it } from 'vitest';
import { buildCombos, runStrategyLab } from '../lib/trading/strategy-lab';

const config = { initialCapitalUsd: 100, tradeAmountUsd: 10, feePercent: 0.1, slippagePercent: 0.05 };

function series(seed: number, length = 1500) {
  let s = seed;
  const rnd = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  let price = 100;
  return Array.from({ length }, (_, i) => {
    const o = price; const c = o * (1 + (rnd() - 0.5) * 0.012); price = c;
    return { timestamp: new Date(Date.UTC(2026, 0, 1, i)).toISOString(), open: o,
      high: Math.max(o, c) * 1.001, low: Math.min(o, c) * 0.999, close: c, volume: 10 + rnd() * 20 };
  });
}

describe('strategy lab', () => {
  it('builds 90 unique combinations', () => {
    const ids = buildCombos().map((c) => c.id);
    expect(ids).toHaveLength(90);
    expect(new Set(ids).size).toBe(90);
  });
  it('ranks by train only and returns benchmarks', () => {
    const r = runStrategyLab([{ symbol: 'A', candles: series(1) }, { symbol: 'B', candles: series(2) }], config);
    const qualified = r.rows.filter((x) => Math.min(...x.perSymbol.map((p) => p.train.trades)) >= 5);
    const trains = qualified.map((x) => x.avgTrainReturn);
    expect([...trains].sort((a, b) => b - a)).toEqual(trains);
    expect(r.benchmarks).toHaveLength(2);
    expect(r.trainCandles).toBeGreaterThan(r.testCandles);
  });
  it('rejects short data and invalid config', () => {
    expect(() => runStrategyLab([{ symbol: 'A', candles: series(1, 100) }], config)).toThrow('INVALID_BACKTEST_INPUT');
    expect(() => runStrategyLab([{ symbol: 'A', candles: series(1) }], { ...config, tradeAmountUsd: 500 })).toThrow('INVALID_BACKTEST_CONFIG');
  });
  it('costs never improve results', () => {
    const data = [{ symbol: 'A', candles: series(3) }];
    const free = runStrategyLab(data, { ...config, feePercent: 0, slippagePercent: 0 });
    const costly = runStrategyLab(data, config);
    const best = (r: typeof free) => Math.max(...r.rows.map((x) => x.avgTrainReturn));
    expect(best(costly)).toBeLessThanOrEqual(best(free) + 1e-9);
  });
});
