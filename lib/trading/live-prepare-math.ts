/**
 * Pure helpers for preparing a manual (owner-initiated) live order.
 * No database, no network: everything here is deterministic and unit-testable.
 */

export type PrepareCandle = {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type MarketSnapshot = {
  price: number;
  previousPrice: number;
  fastAverage: number;
  slowAverage: number;
  volume: number;
  averageVolume: number;
};

export const FAST_WINDOW = 10;
export const SLOW_WINDOW = 30;

export function mean(values: readonly number[]): number {
  if (values.length === 0) throw new Error("LIVE_MARKET_DATA_UNAVAILABLE");
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/** Snapshot of the latest market state from recent candles (oldest first). */
export function buildMarketSnapshot(candles: readonly PrepareCandle[]): MarketSnapshot {
  if (candles.length < SLOW_WINDOW + 1) throw new Error("LIVE_MARKET_DATA_UNAVAILABLE");

  const closes = candles.map((candle) => candle.close);
  const volumes = candles.map((candle) => candle.volume);
  const last = candles[candles.length - 1];
  const previous = candles[candles.length - 2];

  const averageVolume = mean(volumes.slice(-SLOW_WINDOW));
  const snapshot: MarketSnapshot = {
    price: last.close,
    previousPrice: previous.close,
    fastAverage: mean(closes.slice(-FAST_WINDOW)),
    slowAverage: mean(closes.slice(-SLOW_WINDOW)),
    // A just-opened candle can have a tiny/zero volume; fall back to the average.
    volume: last.volume > 0 ? last.volume : averageVolume,
    averageVolume,
  };

  for (const value of Object.values(snapshot)) {
    if (!Number.isFinite(value) || value <= 0) throw new Error("LIVE_MARKET_DATA_UNAVAILABLE");
  }
  return snapshot;
}

export type LiveOrderForRisk = {
  symbol: string;
  amountUsd: number;
  status: string;
  realizedPnlUsd: number | null;
  updatedAt: Date;
};

/**
 * Statuses that still tie up capital or may hold a position. Unknown and
 * mismatched orders are counted as open on purpose (fail closed).
 * INTENT_CREATED is excluded: nothing was ever sent to the exchange.
 */
export const OPEN_LIVE_STATUSES: ReadonlySet<string> = new Set([
  "SUBMITTING",
  "SUBMITTED",
  "PARTIALLY_FILLED",
  "FILLED",
  "PROTECTION_PENDING",
  "PROTECTED",
  "PROTECTION_FAILED",
  "UNKNOWN",
  "RECONCILIATION_MISMATCH",
]);

export type LiveRiskSnapshot = {
  requestedAmountUsd: number;
  dailyLossUsd: number;
  openTrades: number;
  totalExposureUsd: number;
  assetExposureUsd: number;
  consecutiveLosses: number;
  hasStopLoss: boolean;
  hasTakeProfit: boolean;
};

export function startOfUtcDay(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

export function buildLiveRiskSnapshot(
  orders: readonly LiveOrderForRisk[],
  input: {
    symbol: string;
    requestedAmountUsd: number;
    hasStopLoss: boolean;
    hasTakeProfit: boolean;
    now: Date;
  },
): LiveRiskSnapshot {
  const symbol = input.symbol.trim().toUpperCase();
  const open = orders.filter((order) => OPEN_LIVE_STATUSES.has(order.status));

  const totalExposureUsd = open.reduce((total, order) => total + order.amountUsd, 0);
  const assetExposureUsd = open
    .filter((order) => order.symbol.trim().toUpperCase() === symbol)
    .reduce((total, order) => total + order.amountUsd, 0);

  const closed = orders
    .filter((order) => order.status === "CLOSED" && order.realizedPnlUsd !== null)
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

  const dayStart = startOfUtcDay(input.now);
  const todayNet = closed
    .filter((order) => order.updatedAt.getTime() >= dayStart)
    .reduce((total, order) => total + (order.realizedPnlUsd ?? 0), 0);

  let consecutiveLosses = 0;
  for (const order of closed) {
    if ((order.realizedPnlUsd ?? 0) < 0) consecutiveLosses += 1;
    else break;
  }

  return {
    requestedAmountUsd: input.requestedAmountUsd,
    dailyLossUsd: Math.max(0, -todayNet),
    openTrades: open.length,
    totalExposureUsd,
    assetExposureUsd,
    consecutiveLosses,
    hasStopLoss: input.hasStopLoss,
    hasTakeProfit: input.hasTakeProfit,
  };
}

const SYMBOL_PATTERN = /^[A-Z0-9]{2,15}USDT$/;

/** Accepts "BTC/USDT" or "btcusdt"; only USDT-quoted spot symbols are allowed. */
export function normalizeLiveSymbol(value: unknown): string {
  if (typeof value !== "string") throw new Error("INVALID_LIVE_ORDER_INPUT");
  const symbol = value.trim().toUpperCase().replaceAll("/", "");
  if (!SYMBOL_PATTERN.test(symbol)) throw new Error("INVALID_LIVE_ORDER_SYMBOL");
  return symbol;
}

export function parseLiveAmountUsd(value: unknown): number {
  const amount = typeof value === "string" ? Number(value) : value;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 1 || amount > 100_000) {
    throw new Error("INVALID_LIVE_ORDER_AMOUNT");
  }
  if (Math.round(amount * 100) / 100 !== amount) throw new Error("INVALID_LIVE_ORDER_AMOUNT");
  return amount;
}

export function parseLivePercent(value: unknown, min: number, max: number, code: string): number {
  const percent = typeof value === "string" ? Number(value) : value;
  if (typeof percent !== "number" || !Number.isFinite(percent) || percent < min || percent > max) {
    throw new Error(code);
  }
  return percent;
}
