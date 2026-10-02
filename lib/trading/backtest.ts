/**
 * GameVortex AI Trading — deterministic backtesting foundation.
 *
 * Backtests are research output only. They do not imply future performance and
 * cannot place orders or alter wallets.
 */

import { evaluateStrategy } from "@/lib/trading/strategy";

export type BacktestCandle = {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  fastAverage: number;
  slowAverage: number;
  averageVolume: number;
};

export type BacktestConfig = {
  initialCapitalUsd: number;
  tradeAmountUsd: number;
  stopLossPercent: number;
  takeProfitPercent: number;
};

export type BacktestTrade = {
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  amountUsd: number;
  pnlUsd: number;
  exitReason: "STOP_LOSS" | "TAKE_PROFIT" | "END_OF_DATA";
};

export type BacktestResult = {
  initialCapitalUsd: number;
  finalCapitalUsd: number;
  pnlUsd: number;
  returnPercent: number;
  maxDrawdownUsd: number;
  maxDrawdownPercent: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRatePercent: number;
  grossProfitUsd: number;
  grossLossUsd: number;
  profitFactor: number | null;
  trades: BacktestTrade[];
};

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function validateCandle(candle: BacktestCandle): void {
  const timestamp = Date.parse(candle.timestamp);
  const prices = [candle.open, candle.high, candle.low, candle.close];
  const indicators = [candle.volume, candle.fastAverage, candle.slowAverage, candle.averageVolume];

  if (
    !Number.isFinite(timestamp) ||
    !prices.every(positiveFinite) ||
    !indicators.every(positiveFinite) ||
    candle.high < Math.max(candle.open, candle.close) ||
    candle.low > Math.min(candle.open, candle.close) ||
    candle.low > candle.high
  ) {
    throw new Error("INVALID_BACKTEST_CANDLE");
  }
}

function validateConfig(config: BacktestConfig): void {
  if (!positiveFinite(config.initialCapitalUsd) || !positiveFinite(config.tradeAmountUsd)) {
    throw new Error("INVALID_BACKTEST_CONFIG");
  }
  if (config.tradeAmountUsd > config.initialCapitalUsd) throw new Error("INVALID_BACKTEST_CONFIG");
  if (!positiveFinite(config.stopLossPercent) || !positiveFinite(config.takeProfitPercent)) {
    throw new Error("INVALID_BACKTEST_CONFIG");
  }
  if (config.stopLossPercent >= 100 || config.takeProfitPercent >= 100) {
    throw new Error("INVALID_BACKTEST_CONFIG");
  }
}

function validateCandleSeries(candles: readonly BacktestCandle[]): void {
  candles.forEach(validateCandle);

  for (let index = 1; index < candles.length; index += 1) {
    const previousTimestamp = Date.parse(candles[index - 1].timestamp);
    const currentTimestamp = Date.parse(candles[index].timestamp);
    if (currentTimestamp <= previousTimestamp) {
      throw new Error("INVALID_BACKTEST_TIMESTAMP_ORDER");
    }
  }
}

/**
 * Simulates one spot position at a time. If one candle touches both exits,
 * STOP_LOSS wins because intrabar order is unknown and this is conservative.
 */
export function runBacktest(
  symbol: string,
  candles: readonly BacktestCandle[],
  config: BacktestConfig,
): BacktestResult {
  const normalizedSymbol = symbol.trim().toUpperCase();
  if (!/^[A-Z0-9._:-]{1,32}$/.test(normalizedSymbol) || candles.length === 0) {
    throw new Error("INVALID_BACKTEST_INPUT");
  }
  validateConfig(config);
  validateCandleSeries(candles);

  let capital = config.initialCapitalUsd;
  let peakCapital = capital;
  let maxDrawdownUsd = 0;
  let entry:
    | { timestamp: string; price: number; amountUsd: number; stopLoss: number; takeProfit: number }
    | undefined;
  const trades: BacktestTrade[] = [];

  for (let index = 1; index < candles.length; index += 1) {
    const previous = candles[index - 1];
    const candle = candles[index];

    if (entry) {
      let exitPrice: number | undefined;
      let exitReason: BacktestTrade["exitReason"] | undefined;

      if (candle.low <= entry.stopLoss) {
        exitPrice = entry.stopLoss;
        exitReason = "STOP_LOSS";
      } else if (candle.high >= entry.takeProfit) {
        exitPrice = entry.takeProfit;
        exitReason = "TAKE_PROFIT";
      }

      if (exitPrice !== undefined && exitReason) {
        const pnlUsd = entry.amountUsd * ((exitPrice - entry.price) / entry.price);
        capital += pnlUsd;
        trades.push({
          entryTime: entry.timestamp,
          exitTime: candle.timestamp,
          entryPrice: entry.price,
          exitPrice,
          amountUsd: entry.amountUsd,
          pnlUsd,
          exitReason,
        });
        entry = undefined;
      }
      peakCapital = Math.max(peakCapital, capital);
      maxDrawdownUsd = Math.max(maxDrawdownUsd, peakCapital - capital);
      continue;
    }

    const strategy = evaluateStrategy({
      symbol: normalizedSymbol,
      price: candle.close,
      previousPrice: previous.close,
      fastAverage: candle.fastAverage,
      slowAverage: candle.slowAverage,
      volume: candle.volume,
      averageVolume: candle.averageVolume,
      stopLossPercent: config.stopLossPercent,
      takeProfitPercent: config.takeProfitPercent,
    });

    if (
      strategy.side === "BUY" &&
      strategy.stopLossPrice !== undefined &&
      strategy.takeProfitPrice !== undefined &&
      capital >= config.tradeAmountUsd
    ) {
      entry = {
        timestamp: candle.timestamp,
        price: candle.close,
        amountUsd: config.tradeAmountUsd,
        stopLoss: strategy.stopLossPrice,
        takeProfit: strategy.takeProfitPrice,
      };
    }

    peakCapital = Math.max(peakCapital, capital);
    maxDrawdownUsd = Math.max(maxDrawdownUsd, peakCapital - capital);
  }

  if (entry) {
    const finalCandle = candles[candles.length - 1];
    const pnlUsd = entry.amountUsd * ((finalCandle.close - entry.price) / entry.price);
    capital += pnlUsd;
    trades.push({
      entryTime: entry.timestamp,
      exitTime: finalCandle.timestamp,
      entryPrice: entry.price,
      exitPrice: finalCandle.close,
      amountUsd: entry.amountUsd,
      pnlUsd,
      exitReason: "END_OF_DATA",
    });
    peakCapital = Math.max(peakCapital, capital);
    maxDrawdownUsd = Math.max(maxDrawdownUsd, peakCapital - capital);
  }

  const pnlUsd = capital - config.initialCapitalUsd;
  const winningTrades = trades.filter((trade) => trade.pnlUsd > 0).length;
  const totalTrades = trades.length;
  const grossProfitUsd = trades
    .filter((trade) => trade.pnlUsd > 0)
    .reduce((sum, trade) => sum + trade.pnlUsd, 0);
  const grossLossUsd = trades
    .filter((trade) => trade.pnlUsd < 0)
    .reduce((sum, trade) => sum + Math.abs(trade.pnlUsd), 0);

  return {
    initialCapitalUsd: config.initialCapitalUsd,
    finalCapitalUsd: capital,
    pnlUsd,
    returnPercent: (pnlUsd / config.initialCapitalUsd) * 100,
    maxDrawdownUsd,
    maxDrawdownPercent: (maxDrawdownUsd / config.initialCapitalUsd) * 100,
    totalTrades,
    winningTrades,
    losingTrades: totalTrades - winningTrades,
    winRatePercent: totalTrades === 0 ? 0 : (winningTrades / totalTrades) * 100,
    grossProfitUsd,
    grossLossUsd,
    profitFactor: grossLossUsd === 0 ? (grossProfitUsd > 0 ? null : 0) : grossProfitUsd / grossLossUsd,
    trades,
  };
}
