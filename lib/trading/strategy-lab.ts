/**
 * GameVortex AI Trading — Strategy Lab (research only).
 *
 * Compares several long-only spot entry families on several symbols at once,
 * with fees + slippage, ATR-based exits, a chronological TRAIN/TEST split, and
 * a buy-and-hold benchmark. Ranking uses TRAIN only. Nothing here places
 * orders or touches wallets, and a good result never implies future profit.
 */

export type LabCandle = {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type LabConfig = {
  initialCapitalUsd: number;
  tradeAmountUsd: number;
  feePercent: number;
  slippagePercent: number;
};

export type LabFamily = "MA_TREND" | "BREAKOUT" | "RSI_DIP";

export type LabCombo = {
  id: string;
  family: LabFamily;
  label: string;
  fast?: number;
  slow?: number;
  lookback?: number;
  trendFilter?: boolean;
  rsiMax?: number;
  atrStop: number;
  atrTarget: number;
};

export type LabSegment = {
  trades: number;
  winRatePercent: number;
  returnPercent: number;
  maxDrawdownPercent: number;
  exposurePercent: number;
};

export type LabSymbolResult = { symbol: string; train: LabSegment; test: LabSegment };

export type LabRow = {
  id: string;
  family: LabFamily;
  label: string;
  avgTrainReturn: number;
  avgTestReturn: number;
  trainPositiveSymbols: number;
  testPositiveSymbols: number;
  minTrades: number;
  robust: boolean;
  perSymbol: LabSymbolResult[];
};

export type LabBenchmark = {
  symbol: string;
  trainReturnPercent: number;
  testReturnPercent: number;
  testMaxDrawdownPercent: number;
};

export type LabResult = {
  totalCombinations: number;
  robustCount: number;
  trainCandles: number;
  testCandles: number;
  benchmarks: LabBenchmark[];
  rows: LabRow[];
  bestPerFamily: LabRow[];
};

const WARMUP = 200;
const MIN_CANDLES = 600;
const TRAIN_RATIO = 0.7;
const MAX_HOLD_CANDLES = 100;
const MIN_TRADES = 15;
const TOP_ROWS = 10;

const MA_PAIRS: ReadonlyArray<readonly [number, number]> = [[5, 20], [10, 30], [20, 50]];
const BREAKOUT_LOOKBACKS: readonly number[] = [20, 50];
const RSI_LEVELS: readonly number[] = [25, 30, 35];
const ATR_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [2, 3], [2, 4], [2, 6], [2, 8], [3, 4], [3, 6], [3, 8], [4, 6], [4, 8],
];

export function buildCombos(): LabCombo[] {
  const combos: LabCombo[] = [];
  for (const [stop, target] of ATR_PAIRS) {
    const exit = `ATR ${stop}/${target}`;
    for (const [fast, slow] of MA_PAIRS) {
      combos.push({ id: `ma-${fast}-${slow}-${stop}-${target}`, family: "MA_TREND", label: `MA ${fast}/${slow} · ${exit}`, fast, slow, atrStop: stop, atrTarget: target });
    }
    for (const lookback of BREAKOUT_LOOKBACKS) {
      for (const trendFilter of [false, true]) {
        combos.push({
          id: `bo-${lookback}-${trendFilter ? "f" : "n"}-${stop}-${target}`,
          family: "BREAKOUT",
          label: `Breakout ${lookback}${trendFilter ? " +SMA200" : ""} · ${exit}`,
          lookback, trendFilter, atrStop: stop, atrTarget: target,
        });
      }
    }
    for (const rsiMax of RSI_LEVELS) {
      combos.push({ id: `rsi-${rsiMax}-${stop}-${target}`, family: "RSI_DIP", label: `RSI<${rsiMax} +SMA200 · ${exit}`, rsiMax, atrStop: stop, atrTarget: target });
    }
  }
  return combos;
}

// ---------- indicators ----------

function smaSeries(values: readonly number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(Number.NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function atrSeries(candles: readonly LabCandle[], period: number): number[] {
  const tr = candles.map((c, i) =>
    i === 0 ? c.high - c.low : Math.max(c.high - c.low, Math.abs(c.high - candles[i - 1].close), Math.abs(c.low - candles[i - 1].close)),
  );
  return smaSeries(tr, period);
}

function rsiSeries(closes: readonly number[], period: number): number[] {
  const out = new Array<number>(closes.length).fill(Number.NaN);
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < closes.length; i += 1) {
    const change = closes[i] - closes[i - 1];
    const up = Math.max(change, 0);
    const down = Math.max(-change, 0);
    if (i <= period) {
      gain += up;
      loss += down;
      if (i === period) {
        gain /= period;
        loss /= period;
        out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
      }
    } else {
      gain = (gain * (period - 1) + up) / period;
      loss = (loss * (period - 1) + down) / period;
      out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    }
  }
  return out;
}

/** Highest high of the previous n candles (excludes the current one). */
function highestPrevious(highs: readonly number[], n: number): number[] {
  const out = new Array<number>(highs.length).fill(Number.NaN);
  for (let i = n; i < highs.length; i += 1) {
    let max = -Infinity;
    for (let j = i - n; j < i; j += 1) if (highs[j] > max) max = highs[j];
    out[i] = max;
  }
  return out;
}

type Indicators = {
  closes: number[];
  sma: Map<number, number[]>;
  volAvg: number[];
  atr: number[];
  rsi: number[];
  hh: Map<number, number[]>;
};

function buildIndicators(candles: readonly LabCandle[]): Indicators {
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const periods = new Set<number>([200]);
  MA_PAIRS.forEach(([f, s]) => { periods.add(f); periods.add(s); });
  const sma = new Map<number, number[]>();
  periods.forEach((p) => sma.set(p, smaSeries(closes, p)));
  const hh = new Map<number, number[]>();
  BREAKOUT_LOOKBACKS.forEach((n) => hh.set(n, highestPrevious(highs, n)));
  return {
    closes,
    sma,
    volAvg: smaSeries(candles.map((c) => c.volume), 20),
    atr: atrSeries(candles, 14),
    rsi: rsiSeries(closes, 14),
    hh,
  };
}

function entrySignal(combo: LabCombo, ind: Indicators, candles: readonly LabCandle[], i: number): boolean {
  const close = candles[i].close;
  const sma200 = ind.sma.get(200)![i];
  if (combo.family === "MA_TREND") {
    const fast = ind.sma.get(combo.fast!)![i];
    const slow = ind.sma.get(combo.slow!)![i];
    return fast > slow && close > slow && close > candles[i - 1].close && candles[i].volume >= ind.volAvg[i];
  }
  if (combo.family === "BREAKOUT") {
    const level = ind.hh.get(combo.lookback!)![i];
    if (!(close > level)) return false;
    return combo.trendFilter ? close > sma200 : true;
  }
  return ind.rsi[i] < combo.rsiMax! && close > sma200;
}

// ---------- simulation ----------

function simulateSegment(
  combo: LabCombo,
  ind: Indicators,
  candles: readonly LabCandle[],
  start: number,
  end: number,
  config: LabConfig,
): LabSegment {
  const fee = config.feePercent / 100;
  const slip = config.slippagePercent / 100;
  let capital = config.initialCapitalUsd;
  let peak = capital;
  let maxDrawdownUsd = 0;
  let inPosition = false;
  let entryPrice = 0;
  let stop = 0;
  let target = 0;
  let entryIndex = 0;
  let exposure = 0;
  let wins = 0;
  let trades = 0;

  const settle = (exitPrice: number) => {
    const effectiveEntry = entryPrice * (1 + slip);
    const effectiveExit = exitPrice * (1 - slip);
    const gross = effectiveExit / effectiveEntry - 1;
    const ret = gross - (2 + gross) * fee;
    const pnl = config.tradeAmountUsd * ret;
    capital += pnl;
    trades += 1;
    if (pnl > 0) wins += 1;
    peak = Math.max(peak, capital);
    maxDrawdownUsd = Math.max(maxDrawdownUsd, peak - capital);
    inPosition = false;
  };

  for (let i = start; i < end; i += 1) {
    const candle = candles[i];
    if (inPosition) {
      exposure += 1;
      let exitPrice: number | undefined;
      if (candle.open <= stop) exitPrice = candle.open;
      else if (candle.low <= stop) exitPrice = stop;
      else if (candle.high >= target) exitPrice = target;
      else if (i - entryIndex >= MAX_HOLD_CANDLES) exitPrice = candle.close;
      if (exitPrice !== undefined) settle(exitPrice);
      continue;
    }
    const atr = ind.atr[i];
    if (!Number.isFinite(atr) || atr <= 0 || capital < config.tradeAmountUsd) continue;
    if (!entrySignal(combo, ind, candles, i)) continue;
    const candidateStop = candle.close - combo.atrStop * atr;
    if (candidateStop <= 0) continue;
    inPosition = true;
    entryPrice = candle.close;
    stop = candidateStop;
    target = candle.close + combo.atrTarget * atr;
    entryIndex = i;
  }
  if (inPosition) settle(candles[end - 1].close);

  const length = Math.max(1, end - start);
  return {
    trades,
    winRatePercent: trades === 0 ? 0 : (wins / trades) * 100,
    returnPercent: ((capital - config.initialCapitalUsd) / config.initialCapitalUsd) * 100,
    maxDrawdownPercent: (maxDrawdownUsd / config.initialCapitalUsd) * 100,
    exposurePercent: (exposure / length) * 100,
  };
}

function benchmark(symbol: string, candles: readonly LabCandle[], start: number, split: number, end: number): LabBenchmark {
  const trainReturn = (candles[split - 1].close / candles[start].close - 1) * 100;
  const testReturn = (candles[end - 1].close / candles[split].close - 1) * 100;
  let peak = candles[split].close;
  let maxDd = 0;
  for (let i = split; i < end; i += 1) {
    peak = Math.max(peak, candles[i].close);
    maxDd = Math.max(maxDd, (peak - candles[i].close) / peak);
  }
  return { symbol, trainReturnPercent: trainReturn, testReturnPercent: testReturn, testMaxDrawdownPercent: maxDd * 100 };
}

function validateConfig(config: LabConfig): void {
  const ok =
    Number.isFinite(config.initialCapitalUsd) && config.initialCapitalUsd > 0 &&
    Number.isFinite(config.tradeAmountUsd) && config.tradeAmountUsd >= 1 && config.tradeAmountUsd <= config.initialCapitalUsd &&
    Number.isFinite(config.feePercent) && config.feePercent >= 0 && config.feePercent <= 5 &&
    Number.isFinite(config.slippagePercent) && config.slippagePercent >= 0 && config.slippagePercent <= 5;
  if (!ok) throw new Error("INVALID_BACKTEST_CONFIG");
}

function validateCandles(candles: readonly LabCandle[]): void {
  if (candles.length < MIN_CANDLES || candles.length > 10_000) throw new Error("INVALID_BACKTEST_INPUT");
  for (let i = 0; i < candles.length; i += 1) {
    const c = candles[i];
    const valid =
      [c.open, c.high, c.low, c.close, c.volume].every((v) => Number.isFinite(v) && v > 0) &&
      c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close);
    if (!valid || !Number.isFinite(Date.parse(c.timestamp))) throw new Error("INVALID_BACKTEST_CANDLE");
    if (i > 0 && Date.parse(c.timestamp) <= Date.parse(candles[i - 1].timestamp)) {
      throw new Error("INVALID_BACKTEST_TIMESTAMP_ORDER");
    }
  }
}

export function runStrategyLab(
  datasets: ReadonlyArray<{ symbol: string; candles: readonly LabCandle[] }>,
  config: LabConfig,
): LabResult {
  validateConfig(config);
  if (datasets.length < 1 || datasets.length > 5) throw new Error("INVALID_BACKTEST_INPUT");

  const combos = buildCombos();
  const prepared = datasets.map(({ symbol, candles }) => {
    validateCandles(candles);
    const split = WARMUP + Math.floor((candles.length - WARMUP) * TRAIN_RATIO);
    return { symbol, candles, ind: buildIndicators(candles), split };
  });

  const benchmarks = prepared.map((p) => benchmark(p.symbol, p.candles, WARMUP, p.split, p.candles.length));

  const rows: LabRow[] = combos.map((combo) => {
    const perSymbol: LabSymbolResult[] = prepared.map((p) => ({
      symbol: p.symbol,
      train: simulateSegment(combo, p.ind, p.candles, WARMUP, p.split, config),
      test: simulateSegment(combo, p.ind, p.candles, p.split, p.candles.length, config),
    }));
    const n = perSymbol.length;
    const avgTrainReturn = perSymbol.reduce((s, r) => s + r.train.returnPercent, 0) / n;
    const avgTestReturn = perSymbol.reduce((s, r) => s + r.test.returnPercent, 0) / n;
    const trainPositiveSymbols = perSymbol.filter((r) => r.train.returnPercent > 0).length;
    const testPositiveSymbols = perSymbol.filter((r) => r.test.returnPercent > 0).length;
    const minTrades = Math.min(...perSymbol.flatMap((r) => [r.train.trades, r.test.trades]));
    const needed = Math.floor(n / 2) + 1;
    const robust =
      avgTrainReturn > 0 && avgTestReturn > 0 &&
      trainPositiveSymbols >= needed && testPositiveSymbols >= needed &&
      minTrades >= MIN_TRADES;
    return { id: combo.id, family: combo.family, label: combo.label, avgTrainReturn, avgTestReturn, trainPositiveSymbols, testPositiveSymbols, minTrades, robust, perSymbol };
  });

  // Rank by TRAIN only. TEST is never used for ranking. Combinations with too
  // few trades are listed after the others so "does nothing" never looks best.
  const trainTrades = new Map(
    rows.map((row) => [row.id, Math.min(...row.perSymbol.map((r) => r.train.trades))]),
  );
  const qualified = (row: LabRow) => (trainTrades.get(row.id) ?? 0) >= MIN_TRADES;
  rows.sort((a, b) => {
    const qa = qualified(a) ? 1 : 0;
    const qb = qualified(b) ? 1 : 0;
    return qb - qa || b.avgTrainReturn - a.avgTrainReturn;
  });

  const families: LabFamily[] = ["MA_TREND", "BREAKOUT", "RSI_DIP"];
  const bestPerFamily = families
    .map((family) => rows.find((row) => row.family === family))
    .filter((row): row is LabRow => row !== undefined);

  return {
    totalCombinations: rows.length,
    robustCount: rows.filter((row) => row.robust).length,
    trainCandles: prepared[0].split - WARMUP,
    testCandles: prepared[0].candles.length - prepared[0].split,
    benchmarks,
    rows: rows.slice(0, TOP_ROWS),
    bestPerFamily,
  };
}
