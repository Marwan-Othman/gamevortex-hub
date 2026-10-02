/**
 * GameVortex AI Trading — Binance Spot Testnet adapter.
 *
 * This adapter is deliberately testnet-only. It can read public Spot Testnet
 * candles and, when credentials are supplied server-side, submit a Spot BUY
 * against the Binance Spot Testnet. It never targets the production Binance
 * API and it never exposes credentials to callers.
 *
 * This is preparation for live trading, not live trading itself. The existing
 * executor remains fail-closed for LIVE mode until a separately reviewed
 * production adapter and reconciliation path exist.
 */

import { createHmac } from "node:crypto";
import type { MarketCandle } from "@/lib/trading/market-data";
import {
  validateExchangeMarketDataRequest,
  validateExchangeOrderRequest,
  type ExchangeAdapter,
  type ExchangeMarketDataRequest,
  type ExchangeMarketDataResponse,
  type ExchangeOrderRequest,
  type ExchangeOrderResult,
} from "@/lib/trading/exchange-adapter";

const DEFAULT_BASE_URL = "https://testnet.binance.vision";
const DEFAULT_RECV_WINDOW = 5_000;
const MAX_LIMIT = 1_000;

export type BinanceSpotTestnetAdapterOptions = {
  apiKey?: string;
  apiSecret?: string;
  baseUrl?: string;
  recvWindow?: number;
  fetcher?: typeof fetch;
  symbolMap?: Readonly<Record<string, string>>;
};

type BinanceKline = [
  number,
  string,
  string,
  string,
  string,
  string,
  number,
  string,
  number,
  string,
  string,
  string,
];

type BinanceOrderResponse = {
  symbol?: string;
  orderId?: number;
  clientOrderId?: string;
  status?: string;
};

function normalizeBaseUrl(value: string | undefined): string {
  const baseUrl = (value ?? DEFAULT_BASE_URL).trim().replace(/\/$/, "");
  if (!baseUrl || !/^https:\/\//i.test(baseUrl)) {
    throw new Error("INVALID_BINANCE_TESTNET_BASE_URL");
  }

  if (baseUrl !== DEFAULT_BASE_URL) {
    throw new Error("BINANCE_TESTNET_BASE_URL_MUST_BE_OFFICIAL_TESTNET");
  }

  return baseUrl;
}

function normalizeProviderSymbol(symbol: string, symbolMap: Readonly<Record<string, string>>): string {
  const normalized = symbol.trim().toUpperCase();
  const mapped = symbolMap[normalized] ?? normalized.replaceAll("/", "");

  if (!mapped || !/^[A-Z0-9]{1,20}$/.test(mapped)) {
    throw new Error("INVALID_BINANCE_TESTNET_SYMBOL");
  }

  return mapped;
}

function positiveNumber(value: string, code: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(code);
  return parsed;
}

function mapKline(kline: BinanceKline): MarketCandle {
  const [openTime, open, high, low, close, volume] = kline;
  return {
    timestamp: new Date(openTime).toISOString(),
    open: positiveNumber(open, "INVALID_BINANCE_TESTNET_CANDLE"),
    high: positiveNumber(high, "INVALID_BINANCE_TESTNET_CANDLE"),
    low: positiveNumber(low, "INVALID_BINANCE_TESTNET_CANDLE"),
    close: positiveNumber(close, "INVALID_BINANCE_TESTNET_CANDLE"),
    volume: positiveNumber(volume, "INVALID_BINANCE_TESTNET_CANDLE"),
  };
}

function encodeQuery(params: Record<string, string | number>): string {
  return Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
}

function sign(query: string, secret: string): string {
  return createHmac("sha256", secret).update(query).digest("hex");
}

async function parseJson(response: Response): Promise<unknown> {
  const payload: unknown = await response.json();
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "msg" in payload && typeof payload.msg === "string"
        ? payload.msg
        : `HTTP_${response.status}`;
    throw new Error(`BINANCE_TESTNET_${message}`);
  }
  return payload;
}

export class BinanceSpotTestnetAdapter implements ExchangeAdapter {
  readonly id = "binance-spot-testnet";
  readonly mode = "MARKET_DATA" as const;
  readonly capabilities = {
    marketData: true,
    paperTrading: true,
    liveOrders: false,
    withdrawals: false,
    margin: false,
    leverage: false,
    shortSelling: false,
    derivatives: false,
  } as const;

  private readonly apiKey?: string;
  private readonly apiSecret?: string;
  private readonly baseUrl: string;
  private readonly recvWindow: number;
  private readonly fetcher: typeof fetch;
  private readonly symbolMap: Readonly<Record<string, string>>;

  constructor(options: BinanceSpotTestnetAdapterOptions = {}) {
    this.apiKey = options.apiKey?.trim() || undefined;
    this.apiSecret = options.apiSecret?.trim() || undefined;
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.recvWindow = options.recvWindow ?? DEFAULT_RECV_WINDOW;
    this.fetcher = options.fetcher ?? fetch;
    this.symbolMap = Object.fromEntries(
      Object.entries(options.symbolMap ?? {}).map(([key, value]) => [key.trim().toUpperCase(), value.trim().toUpperCase()]),
    );

    if (!Number.isInteger(this.recvWindow) || this.recvWindow < 1 || this.recvWindow > 60_000) {
      throw new Error("INVALID_BINANCE_TESTNET_RECV_WINDOW");
    }
  }

  async getMarketData(request: ExchangeMarketDataRequest): Promise<ExchangeMarketDataResponse> {
    validateExchangeMarketDataRequest(request);
    if (request.limit > MAX_LIMIT) throw new Error("INVALID_MARKET_DATA_LIMIT");

    const symbol = normalizeProviderSymbol(request.symbol, this.symbolMap);
    const query = encodeQuery({ symbol, interval: request.interval.trim(), limit: request.limit });
    const response = await this.fetcher(`${this.baseUrl}/api/v3/klines?${query}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    const payload = await parseJson(response);

    if (!Array.isArray(payload)) throw new Error("INVALID_BINANCE_TESTNET_KLINES_RESPONSE");

    const candles = payload.map((item) => {
      if (!Array.isArray(item) || item.length < 6) throw new Error("INVALID_BINANCE_TESTNET_KLINE");
      return mapKline(item as BinanceKline);
    });

    return {
      symbol,
      interval: request.interval.trim(),
      candles,
    };
  }

  async placeSpotBuy(request: ExchangeOrderRequest): Promise<ExchangeOrderResult> {
    validateExchangeOrderRequest(request);

    if (!this.apiKey || !this.apiSecret) {
      throw new Error("BINANCE_TESTNET_API_CREDENTIALS_REQUIRED");
    }

    const symbol = normalizeProviderSymbol(request.symbol, this.symbolMap);
    const timestamp = Date.now();
    const params = {
      symbol,
      side: "BUY",
      type: "MARKET",
      quoteOrderQty: request.amountUsd.toFixed(8),
      newClientOrderId: request.clientOrderId,
      newOrderRespType: "RESULT",
      recvWindow: this.recvWindow,
      timestamp,
    };
    const query = encodeQuery(params);
    const signature = sign(query, this.apiSecret);

    const response = await this.fetcher(`${this.baseUrl}/api/v3/order?${query}&signature=${signature}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "X-MBX-APIKEY": this.apiKey,
      },
    });
    const payload = (await parseJson(response)) as BinanceOrderResponse;

    if (
      typeof payload.orderId !== "number" ||
      typeof payload.clientOrderId !== "string" ||
      typeof payload.status !== "string"
    ) {
      throw new Error("INVALID_BINANCE_TESTNET_ORDER_RESPONSE");
    }

    return {
      accepted: true,
      clientOrderId: payload.clientOrderId,
      providerOrderId: String(payload.orderId),
      status: payload.status === "FILLED" ? "FILLED" : "REJECTED",
      ...(payload.status === "FILLED" ? {} : { reason: `BINANCE_ORDER_STATUS:${payload.status}` }),
    };
  }
}
