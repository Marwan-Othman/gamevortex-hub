/**
 * GameVortex AI Trading — parameter comparison with a train/test split.
 *
 * Research output only. Every combination is evaluated on a TRAIN segment
 * (older 70% of the data) and on a TEST segment (newer 30%) that was not used
 * to rank anything. A setting is only flagged "robust" when it is profitable on
 * both segments with a minimum number of trades. This reduces, but does not
 * remove, the risk of overfitting; it never implies future performance.
 */

import { runBacktest, type BacktestCandle, type BacktestConfig } from "@/lib/trading/backtest";

export type RawCandle = {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type SweepSegmentSummary = {
  trades: number;
  winRatePercent: number;
  returnPercent: number;
  maxDrawdownPercent: number;
};

export type SweepRow = {
  fastPeriod: number;
  slowPeriod: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  train: SweepSegmentSummary;
  test: SweepSegmentSummary;
  robust: boolean;
};

export type SweepResult = {
  totalCombinations: number;
  robustCount: number;
  trainCandles: number;
  testCandles: number;
  buyAndHoldTestReturnPercent: number;
  rows: SweepRow[];
};

const MIN_CANDLES = 200;
const MAX_CANDLES = 10_000;
const TRAIN_RATIO = 0.7;
const VOLUME_PERIOD = 20;
const MIN_TRADES_PER_SEGMENT = 5;
const TOP_ROWS = 10;

export const SWEEP_PERIOD_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [5, 20],
  [10, 30],
  [20, 50],
];
export const SWEEP_STOP_LOSS: readonly number[] = [1, 1.5, 2, 3];
export const SWEEP_TAKE_PROFIT: readonly number[] = [2, 3, 4, 6];

function sma(values: readonly number[], index: number, period: number): number {
  const start = Math.max(0, index - period + 1);
  let sum = 0;
  for (let i = start; i <= index; i += 1) sum += values[i];
  return sum / (index - start + 1);
}

function withAverages(candles: readonly RawCandle[], fast: number, slow: number): BacktestCandle[] {
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const warmup = Math.max(slow, VOLUME_PERIOD) - 1;
  const out: BacktestCandle[] = [];
  for (let i = warmup; i < candles.length; i += 1) {
    out.push({
      ...candles[i],
      fastAverage: sma(closes, i, fast),
      slowAverage: sma(closes, i, slow),
      averageVolume: sma(volumes, i, VOLUME_PERIOD),
    });
  }
  return out;
}

function summarize(
  symbol: string,
  candles: readonly BacktestCandle[],
  config: BacktestConfig,
): SweepSegmentSummary {
  const result = runBacktest(symbol, candles, config);
  return {
    trades: result.totalTrades,
    winRatePercent: result.winRatePercent,
    returnPercent: result.returnPercent,
    maxDrawdownPercent: result.maxDrawdownPercent,
  };
}

export function runSweep(
  symbol: string,
  rawCandles: readonly RawCandle[],
  baseConfig: BacktestConfig,
): SweepResult {
  if (rawCandles.length < MIN_CANDLES || rawCandles.length > MAX_CANDLES) {
    throw new Error("INVALID_BACKTEST_INPUT");
  }

  // Common usable window so every combination is compared on the same candles.
  const maxWarmup = Math.max(...SWEEP_PERIOD_PAIRS.map(([, slow]) => slow), VOLUME_PERIOD) - 1;
  const usable = rawCandles.slice(maxWarmup);
  const splitAt = Math.floor(usable.length * TRAIN_RATIO);
  const trainRaw = usable.slice(0, splitAt);
  const testRaw = usable.slice(splitAt);
  if (trainRaw.length < 50 || testRaw.length < 50) {
    throw new Error("INVALID_BACKTEST_INPUT");
  }

  const rows: SweepRow[] = [];
  for (const [fastPeriod, slowPeriod] of SWEEP_PERIOD_PAIRS) {
    // Averages are computed on the full history so the test segment starts warm.
    const all = withAverages(rawCandles, fastPeriod, slowPeriod);
    const offset = rawCandles.length - all.length;
    const train = all.slice(maxWarmup - offset, maxWarmup - offset + trainRaw.length);
    const test = all.slice(maxWarmup - offset + trainRaw.length);

    for (const stopLossPercent of SWEEP_STOP_LOSS) {
      for (const takeProfitPercent of SWEEP_TAKE_PROFIT) {
        if (takeProfitPercent <= stopLossPercent) continue;
        const config: BacktestConfig = { ...baseConfig, stopLossPercent, takeProfitPercent };
        const trainSummary = summarize(symbol, train, config);
        const testSummary = summarize(symbol, test, config);
        rows.push({
          fastPeriod,
          slowPeriod,
          stopLossPercent,
          takeProfitPercent,
          train: trainSummary,
          test: testSummary,
          robust:
            trainSummary.returnPercent > 0 &&
            testSummary.returnPercent > 0 &&
            trainSummary.trades >= MIN_TRADES_PER_SEGMENT &&
            testSummary.trades >= MIN_TRADES_PER_SEGMENT,
        });
      }
    }
  }

  // Rank by TRAIN return only; the test segment is never used for ranking.
  rows.sort((a, b) => b.train.returnPercent - a.train.returnPercent);

  const testStart = testRaw[0].close;
  const testEnd = testRaw[testRaw.length - 1].close;

  return {
    totalCombinations: rows.length,
    robustCount: rows.filter((row) => row.robust).length,
    trainCandles: trainRaw.length,
    testCandles: testRaw.length,
    buyAndHoldTestReturnPercent: ((testEnd - testStart) / testStart) * 100,
    rows: rows.slice(0, TOP_ROWS),
  };
}
