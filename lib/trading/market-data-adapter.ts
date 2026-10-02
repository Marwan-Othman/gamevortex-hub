/**
 * GameVortex AI Trading — adapter-to-market-data bridge.
 *
 * This is the only boundary used to turn exchange-adapter OHLCV data into a
 * normalized MarketSnapshot. It performs fail-closed validation before the
 * data reaches strategy, risk, Shariah, or paper-trading layers.
 *
 * No credentials, network clients, orders, wallet mutations, or live execution
 * are implemented here.
 */

import type {
  ExchangeAdapter,
  ExchangeMarketDataRequest,
} from "@/lib/trading/exchange-adapter";
import {
  buildMarketSnapshot,
  type MarketSnapshot,
} from "@/lib/trading/market-data";

const MAX_MARKET_DATA_LIMIT = 1000;

function normalizeSymbol(symbol: string): string {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized || !/^[A-Z0-9._:-]{1,32}$/.test(normalized)) {
    throw new Error("INVALID_MARKET_SYMBOL");
  }
  return normalized;
}

function validateRequest(request: ExchangeMarketDataRequest): string {
  const symbol = normalizeSymbol(request.symbol);
  const interval = request.interval.trim();

  if (!interval || interval.length > 32) {
    throw new Error("INVALID_MARKET_INTERVAL");
  }

  if (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > MAX_MARKET_DATA_LIMIT) {
    throw new Error("INVALID_MARKET_DATA_LIMIT");
  }

  return symbol;
}

/**
 * Fetch normalized market data through an ExchangeAdapter.
 *
 * The adapter must explicitly advertise market-data capability. The returned
 * symbol and interval must match the request, and the provider cannot return
 * more candles than requested. The normalized engine then validates OHLCV
 * relationships and chronology.
 */
export async function getMarketSnapshot(
  adapter: ExchangeAdapter,
  request: ExchangeMarketDataRequest,
): Promise<MarketSnapshot> {
  if (!adapter.capabilities.marketData) {
    throw new Error("MARKET_DATA_NOT_SUPPORTED");
  }

  const normalizedSymbol = validateRequest(request);
  const normalizedInterval = request.interval.trim();
  const response = await adapter.getMarketData({
    symbol: normalizedSymbol,
    interval: normalizedInterval,
    limit: request.limit,
  });

  if (normalizeSymbol(response.symbol) !== normalizedSymbol) {
    throw new Error("MARKET_DATA_SYMBOL_MISMATCH");
  }

  if (response.interval.trim() !== normalizedInterval) {
    throw new Error("MARKET_DATA_INTERVAL_MISMATCH");
  }

  if (response.candles.length === 0) {
    throw new Error("EMPTY_MARKET_DATA_RESPONSE");
  }

  if (response.candles.length > request.limit) {
    throw new Error("MARKET_DATA_LIMIT_EXCEEDED");
  }

  return buildMarketSnapshot(normalizedSymbol, response.candles);
}
