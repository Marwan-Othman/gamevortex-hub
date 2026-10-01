/**
 * GameVortex AI Trading — Market Data contract.
 *
 * Phase 3 starts with a provider-neutral, read-only market-data layer.
 * It deliberately contains no order execution and no withdrawal capability.
 * Providers must return normalized data so the Strategy, Shariah and Risk
 * layers do not depend on an exchange-specific response format.
 */

export type MarketCandle = {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type MarketQuote = {
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  timestamp: string;
  source: string;
};

export type MarketSnapshot = {
  symbol: string;
  quote: MarketQuote;
  candles: readonly MarketCandle[];
};

export type MarketDataCapability =
  | "QUOTE"
  | "OHLCV"
  | "HISTORICAL"
  | "VOLUME";

export interface MarketDataProvider {
  readonly id: string;
  getCapabilities(): readonly MarketDataCapability[];
  getQuote(symbol: string): Promise<MarketQuote>;
  getCandles(symbol: string, limit: number): Promise<readonly MarketCandle[]>;
}

export function normalizeMarketSymbol(symbol: string): string {
  const value = symbol.trim().toUpperCase();
  if (!/^[A-Z0-9._-]{2,32}$/.test(value)) {
    throw new Error("INVALID_TRADING_SYMBOL");
  }
  return value;
}

export function validateMarketQuote(quote: MarketQuote): void {
  if (normalizeMarketSymbol(quote.symbol) !== quote.symbol.trim().toUpperCase()) {
    throw new Error("INVALID_MARKET_QUOTE_SYMBOL");
  }

  const prices = [quote.bid, quote.ask, quote.last];
  if (prices.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error("INVALID_MARKET_QUOTE_PRICE");
  }
  if (quote.bid > quote.ask) throw new Error("INVALID_MARKET_QUOTE_SPREAD");
  if (!quote.source.trim() || Number.isNaN(Date.parse(quote.timestamp))) {
    throw new Error("INVALID_MARKET_QUOTE_METADATA");
  }
}

export function validateMarketCandle(candle: MarketCandle): void {
  const prices = [candle.open, candle.high, candle.low, candle.close, candle.volume];
  if (prices.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error("INVALID_MARKET_CANDLE_VALUE");
  }
  if (candle.open <= 0 || candle.high <= 0 || candle.low <= 0 || candle.close <= 0) {
    throw new Error("INVALID_MARKET_CANDLE_PRICE");
  }
  if (candle.high < Math.max(candle.open, candle.close)) {
    throw new Error("INVALID_MARKET_CANDLE_HIGH");
  }
  if (candle.low > Math.min(candle.open, candle.close)) {
    throw new Error("INVALID_MARKET_CANDLE_LOW");
  }
  if (Number.isNaN(Date.parse(candle.timestamp))) {
    throw new Error("INVALID_MARKET_CANDLE_TIMESTAMP");
  }
}

export function validateCandleLimit(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error("INVALID_MARKET_CANDLE_LIMIT");
  }
  return limit;
}

/**
 * Safe provider used until a real read-only market-data source is configured.
 * It never fabricates prices. Unknown data is an explicit error.
 */
export class UnconfiguredMarketDataProvider implements MarketDataProvider {
  readonly id = "unconfigured" as const;

  getCapabilities(): readonly MarketDataCapability[] {
    return [];
  }

  async getQuote(symbol: string): Promise<MarketQuote> {
    const normalized = normalizeMarketSymbol(symbol);
    throw new Error(`MARKET_DATA_NOT_CONFIGURED:${normalized}`);
  }

  async getCandles(symbol: string, limit: number): Promise<readonly MarketCandle[]> {
    const normalized = normalizeMarketSymbol(symbol);
    validateCandleLimit(limit);
    throw new Error(`MARKET_DATA_NOT_CONFIGURED:${normalized}`);
  }
}

export function createMarketDataProvider(): MarketDataProvider {
  return new UnconfiguredMarketDataProvider();
}
