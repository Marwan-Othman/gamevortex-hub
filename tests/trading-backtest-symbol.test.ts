import { describe, expect, it } from 'vitest';
import { runBacktest } from '../lib/trading/backtest';

const candle = (i: number, close: number) => ({
  timestamp: new Date(Date.UTC(2026, 9, 1, 10, i * 5)).toISOString(),
  open: close, high: close * 1.001, low: close * 0.999, close,
  volume: 1000, fastAverage: close - 1, slowAverage: close - 2, averageVolume: 900,
});

describe('backtest symbol format', () => {
  it('accepts exchange pair notation like BTC/USDT', () => {
    const result = runBacktest('BTC/USDT', [candle(0, 100), candle(1, 102), candle(2, 104)], {
      initialCapitalUsd: 100, tradeAmountUsd: 10, stopLossPercent: 2, takeProfitPercent: 4,
    });
    expect(result.totalTrades).toBeGreaterThanOrEqual(0);
  });
  it('still rejects unsafe symbols', () => {
    expect(() => runBacktest('BTC USDT;', [candle(0, 100)], {
      initialCapitalUsd: 100, tradeAmountUsd: 10, stopLossPercent: 2, takeProfitPercent: 4,
    })).toThrow('INVALID_BACKTEST_INPUT');
  });
});
