/**
 * GameVortex AI Trading — Binance PUBLIC market-data reader (read-only).
 *
 * Uses Binance's market-data-only host. It needs no API key, sends no account
 * data, and exposes no order, wallet or withdrawal capability. Research use only.
 */

import type { MarketCandle } from "@/lib/trading/market-data";

const BASE_URL = "https://data-api.binance.vision";
const ALLOWED_INTERVALS = new Set(["5m", "15m", "1h", "4h"]);
const MAX_LIMIT = 1_000;
const TIMEOUT_MS = 10_000;

export type PublicKlinesRequest = {
  symbol: string;
  interval: string;
  limit: number;
  endTimeMs?: number;
};

export type PublicKlinesResponse = {
  symbol: string;
  interval: string;
  candles: MarketCandle[];
};

type Kline = [number, string, string, string, string, string, ...unknown[]];

export function normalizePublicSymbol(symbol: string): string {
  const normalized = symbol.trim().toUpperCase().replaceAll("/", "");
  if (!/^[A-Z0-9]{2,20}$/.test(normalized)) throw new Error("PUBLIC_MARKET_DATA_INVALID_SYMBOL");
  return normalized;
}

function positive(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error("PUBLIC_MARKET_DATA_INVALID_RESPONSE");
  return parsed;
}

export function mapPublicKline(kline: Kline): MarketCandle {
  const [openTime, open, high, low, close, volume] = kline;
  if (!Number.isFinite(openTime)) throw new Error("PUBLIC_MARKET_DATA_INVALID_RESPONSE");
  return {
    timestamp: new Date(openTime).toISOString(),
    open: positive(open),
    high: positive(high),
    low: positive(low),
    close: positive(close),
    volume: positive(volume),
  };
}

export async function fetchPublicKlines(
  request: PublicKlinesRequest,
  fetcher: typeof fetch = fetch,
): Promise<PublicKlinesResponse> {
  const symbol = normalizePublicSymbol(request.symbol);
  const interval = request.interval.trim();
  if (!ALLOWED_INTERVALS.has(interval)) throw new Error("PUBLIC_MARKET_DATA_INVALID_INTERVAL");
  if (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > MAX_LIMIT) {
    throw new Error("PUBLIC_MARKET_DATA_INVALID_LIMIT");
  }
  if (request.endTimeMs !== undefined && (!Number.isSafeInteger(request.endTimeMs) || request.endTimeMs <= 0)) {
    throw new Error("PUBLIC_MARKET_DATA_INVALID_END_TIME");
  }

  const params = new URLSearchParams({ symbol, interval, limit: String(request.limit) });
  if (request.endTimeMs !== undefined) params.set("endTime", String(request.endTimeMs));

  let response: Response;
  try {
    response = await fetcher(`${BASE_URL}/api/v3/klines?${params.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new Error("PUBLIC_MARKET_DATA_NETWORK_ERROR");
  }

  if (response.status === 400) throw new Error("PUBLIC_MARKET_DATA_SYMBOL_NOT_FOUND");
  if (response.status === 418 || response.status === 429) throw new Error("PUBLIC_MARKET_DATA_RATE_LIMITED");
  if (response.status === 451) throw new Error("PUBLIC_MARKET_DATA_REGION_BLOCKED");
  if (!response.ok) throw new Error("PUBLIC_MARKET_DATA_PROVIDER_ERROR");

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("PUBLIC_MARKET_DATA_INVALID_RESPONSE");
  }
  if (!Array.isArray(payload)) throw new Error("PUBLIC_MARKET_DATA_INVALID_RESPONSE");

  const candles = payload.map((item) => {
    if (!Array.isArray(item) || item.length < 6) throw new Error("PUBLIC_MARKET_DATA_INVALID_RESPONSE");
    return mapPublicKline(item as Kline);
  });
  return { symbol, interval, candles };
}

/** Pages backwards through public klines until `total` candles (max 5000) are collected. */
export async function fetchPublicKlinesPaged(
  symbol: string,
  interval: string,
  total: number,
  fetcher: typeof fetch = fetch,
): Promise<MarketCandle[]> {
  if (!Number.isInteger(total) || total < 1 || total > 5_000) throw new Error("PUBLIC_MARKET_DATA_INVALID_LIMIT");
  const byTime = new Map<string, MarketCandle>();
  let endTimeMs: number | undefined;
  for (let page = 0; page < 7 && byTime.size < total; page += 1) {
    const batch = await fetchPublicKlines(
      { symbol, interval, limit: Math.min(1_000, total - byTime.size), endTimeMs },
      fetcher,
    );
    if (batch.candles.length === 0) break;
    const before = byTime.size;
    for (const candle of batch.candles) byTime.set(candle.timestamp, candle);
    if (byTime.size === before) break;
    endTimeMs = Math.min(...batch.candles.map((c) => Date.parse(c.timestamp))) - 1;
  }
  return Array.from(byTime.values()).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}
