/**
 * GameVortex AI Trading — normalized market-data engine.
 *
 * This module is deliberately source-agnostic and side-effect free. It accepts
 * validated OHLCV observations from a future exchange adapter and produces the
 * normalized data required by strategy, risk, Shariah, and paper-trading layers.
 *
 * It never contacts an exchange, stores credentials, or places orders.
 */

export type MarketCandle = {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type MarketSnapshot = {
  symbol: string;
  timestamp: string;
  price: number;
  previousPrice?: number;
  volume: number;
  averageVolume: number;
  volatilityPercent: number;
  liquidityScore: number;
  candles: readonly MarketCandle[];
};

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function normalizeSymbol(symbol: string): string {
  const value = symbol.trim().toUpperCase();
  if (!value || !/^[A-Z0-9._:-]{1,32}$/.test(value)) {
    throw new Error("INVALID_MARKET_SYMBOL");
  }
  return value;
}

function validateCandle(candle: MarketCandle): void {
  if (!candle.timestamp) throw new Error("INVALID_MARKET_CANDLE_TIMESTAMP");
  if (
    ![candle.open, candle.high, candle.low, candle.close].every(positiveFinite) ||
    !finiteNonNegative(candle.volume)
  ) {
    throw new Error("INVALID_MARKET_CANDLE_VALUES");
  }
  if (candle.high < candle.low || candle.high < candle.open || candle.high < candle.close) {
    throw new Error("INVALID_MARKET_CANDLE_HIGH");
  }
  if (candle.low > candle.open || candle.low > candle.close) {
    throw new Error("INVALID_MARKET_CANDLE_LOW");
  }
}

function averageVolume(candles: readonly MarketCandle[]): number {
  return candles.reduce((sum, candle) => sum + candle.volume, 0) / candles.length;
}

/**
 * Population standard deviation of percentage returns, expressed as percent.
 * At least two candles are required for a meaningful volatility estimate.
 */
export function calculateVolatilityPercent(candles: readonly MarketCandle[]): number {
  if (candles.length < 2) return 0;

  const returns: number[] = [];
  for (let index = 1; index < candles.length; index += 1) {
    returns.push((candles[index].close - candles[index - 1].close) / candles[index - 1].close);
  }

  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance) * 100;
}

/**
 * Produces a bounded 0..100 liquidity score from average traded volume and price.
 * This is a relative heuristic, not an exchange liquidity guarantee.
 */
export function calculateLiquidityScore(candles: readonly MarketCandle[]): number {
  if (candles.length === 0) return 0;
  const averageVol = averageVolume(candles);
  const averageNotional =
    candles.reduce((sum, candle) => sum + candle.close * candle.volume, 0) / candles.length;

  if (!positiveFinite(averageNotional)) return 0;
  const score = Math.log10(1 + averageNotional) * 10;
  return Math.min(100, Math.max(0, score));
}

/**
 * Validate and normalize a batch of OHLCV observations.
 * Observations must be chronological and the newest candle becomes the snapshot price.
 */
export function buildMarketSnapshot(
  symbol: string,
  candles: readonly MarketCandle[],
): MarketSnapshot {
  const normalizedSymbol = normalizeSymbol(symbol);
  if (candles.length === 0) throw new Error("INVALID_MARKET_DATA_INPUT");

  candles.forEach(validateCandle);

  for (let index = 1; index < candles.length; index += 1) {
    if (candles[index].timestamp <= candles[index - 1].timestamp) {
      throw new Error("MARKET_DATA_NOT_CHRONOLOGICAL");
    }
  }

  const latest = candles[candles.length - 1];
  const previous = candles.length > 1 ? candles[candles.length - 2] : undefined;

  return {
    symbol: normalizedSymbol,
    timestamp: latest.timestamp,
    price: latest.close,
    previousPrice: previous?.close,
    volume: latest.volume,
    averageVolume: averageVolume(candles),
    volatilityPercent: calculateVolatilityPercent(candles),
    liquidityScore: calculateLiquidityScore(candles),
    candles,
  };
}
