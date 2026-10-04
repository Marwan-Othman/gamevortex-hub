/**
 * GameVortex AI Trading — Binance Spot Testnet adapter.
 *
 * This adapter is deliberately testnet-only. It can read public Spot Testnet
 * candles and, when credentials are supplied server-side, submit a Spot BUY
 * against the Binance Spot Testnet. It never targets the production Binance
 * API and it never exposes credentials to callers.
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
const MAX_CLIENT_ORDER_ID_LENGTH = 36;

export type BinanceSpotTestnetAdapterOptions = {
  apiKey?: string;
  apiSecret?: string;
  baseUrl?: string;
  recvWindow?: number;
  fetcher?: typeof fetch;
  symbolMap?: Readonly<Record<string, string>>;
};

type BinanceKline = [
  number, string, string, string, string, string, number, string, number, string, string, string
];
type BinanceOrderResponse = { symbol?: string; orderId?: number; clientOrderId?: string; status?: string };
type BinanceAccountResponse = { canTrade?: boolean; canWithdraw?: boolean; canDeposit?: boolean; accountType?: string; permissions?: unknown };
type BinanceErrorPayload = { code?: unknown; msg?: unknown };

export type BinanceSpotTestnetAccountStatus = {
  canTrade: boolean;
  canWithdraw: boolean;
  canDeposit: boolean;
  accountType: string;
  permissions: string[];
};

function normalizeBaseUrl(value: string | undefined): string {
  const baseUrl = (value ?? DEFAULT_BASE_URL).trim().replace(/\/$/, "");
  if (!baseUrl || !/^https:\/\//i.test(baseUrl)) throw new Error("INVALID_BINANCE_TESTNET_BASE_URL");
  if (baseUrl !== DEFAULT_BASE_URL) throw new Error("BINANCE_TESTNET_BASE_URL_MUST_BE_OFFICIAL_TESTNET");
  return baseUrl;
}

function normalizeProviderSymbol(symbol: string, symbolMap: Readonly<Record<string, string>>): string {
  const normalized = symbol.trim().toUpperCase();
  const mapped = symbolMap[normalized] ?? normalized.replaceAll("/", "");
  if (!mapped || !/^[A-Z0-9]{1,20}$/.test(mapped)) throw new Error("INVALID_BINANCE_TESTNET_SYMBOL");
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
  return Object.entries(params).map(([key, value]) => encodeURIComponent(key) + "=" + encodeURIComponent(String(value))).join("&");
}

function sign(query: string, secret: string): string {
  return createHmac("sha256", secret).update(query).digest("hex");
}

function providerErrorCode(status: number, message: string | null, code: unknown): string {
  const normalized = (message ?? "").toLowerCase();
  const numericCode = typeof code === "number" ? code : Number(code);

  if (/restricted location|service unavailable from/i.test(message ?? "")) {
    return "BINANCE_TESTNET_RESTRICTED_LOCATION";
  }
  if (status === 401 || numericCode === -2015 || normalized.includes("invalid api-key") || normalized.includes("invalid api key")) {
    return "BINANCE_TESTNET_API_AUTH_FAILED";
  }
  if (numericCode === -1021 || normalized.includes("recvwindow") || normalized.includes("timestamp")) {
    return "BINANCE_TESTNET_TIMESTAMP_INVALID";
  }
  if (numericCode === -1022 || normalized.includes("signature")) {
    return "BINANCE_TESTNET_SIGNATURE_INVALID";
  }
  if (status === 429 || numericCode === -1003 || normalized.includes("too many requests") || normalized.includes("too many requests; current limit")) {
    return "BINANCE_TESTNET_RATE_LIMITED";
  }
  if (status >= 500 && status <= 599) {
    return "BINANCE_TESTNET_PROVIDER_ERROR";
  }
  return "BINANCE_TESTNET_PROVIDER_ERROR";
}

async function parseJson(response: Response): Promise<unknown> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("BINANCE_TESTNET_INVALID_RESPONSE");
  }
  if (!response.ok) {
    const object = payload && typeof payload === "object" ? (payload as BinanceErrorPayload) : undefined;
    const message = typeof object?.msg === "string" ? object.msg : null;
    throw new Error(providerErrorCode(response.status, message, object?.code));
  }
  return payload;
}

async function fetchWithProviderErrorMapping(fetcher: typeof fetch, input: RequestInfo | URL, init: RequestInit): Promise<Response> {
  try {
    return await fetcher(input, init);
  } catch {
    throw new Error("BINANCE_TESTNET_NETWORK_ERROR");
  }
}

export class BinanceSpotTestnetAdapter implements ExchangeAdapter {
  readonly id = "binance-spot-testnet";
  readonly mode = "MARKET_DATA" as const;
  readonly capabilities = {
    marketData: true, paperTrading: true, liveOrders: false, withdrawals: false,
    margin: false, leverage: false, shortSelling: false, derivatives: false,
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
    this.symbolMap = Object.fromEntries(Object.entries(options.symbolMap ?? {}).map(([key, value]) => [key.trim().toUpperCase(), value.trim().toUpperCase()]));
    if (!Number.isInteger(this.recvWindow) || this.recvWindow < 1 || this.recvWindow > 60_000) throw new Error("INVALID_BINANCE_TESTNET_RECV_WINDOW");
  }

  private requireCredentials(): { apiKey: string; apiSecret: string } {
    if (!this.apiKey || !this.apiSecret) throw new Error("BINANCE_TESTNET_API_CREDENTIALS_REQUIRED");
    return { apiKey: this.apiKey, apiSecret: this.apiSecret };
  }

  private signedQuery(params: Record<string, string | number>, apiSecret: string): string {
    const query = encodeQuery(params);
    return query + "&signature=" + sign(query, apiSecret);
  }

  async getMarketData(request: ExchangeMarketDataRequest): Promise<ExchangeMarketDataResponse> {
    const symbol = normalizeProviderSymbol(request.symbol, this.symbolMap);
    const normalizedRequest = { ...request, symbol };
    validateExchangeMarketDataRequest(normalizedRequest);
    if (request.limit > MAX_LIMIT) throw new Error("INVALID_MARKET_DATA_LIMIT");
    const query = encodeQuery({ symbol, interval: request.interval.trim(), limit: request.limit });
    const response = await fetchWithProviderErrorMapping(this.fetcher, this.baseUrl + "/api/v3/klines?" + query, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    const payload = await parseJson(response);
    if (!Array.isArray(payload)) throw new Error("INVALID_BINANCE_TESTNET_KLINES_RESPONSE");
    const candles = payload.map((item) => {
      if (!Array.isArray(item) || item.length < 6) throw new Error("INVALID_BINANCE_TESTNET_KLINE");
      return mapKline(item as BinanceKline);
    });
    return { symbol, interval: request.interval.trim(), candles };
  }

  async getAccountStatus(): Promise<BinanceSpotTestnetAccountStatus> {
    const { apiKey, apiSecret } = this.requireCredentials();
    const query = this.signedQuery({ recvWindow: this.recvWindow, timestamp: Date.now() }, apiSecret);
    const response = await fetchWithProviderErrorMapping(this.fetcher, this.baseUrl + "/api/v3/account?" + query, {
      method: "GET",
      headers: { Accept: "application/json", "X-MBX-APIKEY": apiKey },
    });
    const payload = (await parseJson(response)) as BinanceAccountResponse;
    if (typeof payload.canTrade !== "boolean" || typeof payload.canWithdraw !== "boolean" || typeof payload.canDeposit !== "boolean" || typeof payload.accountType !== "string") {
      throw new Error("INVALID_BINANCE_TESTNET_ACCOUNT_RESPONSE");
    }
    const permissions = Array.isArray(payload.permissions) ? payload.permissions.filter((value): value is string => typeof value === "string").slice(0, 20) : [];
    return { canTrade: payload.canTrade, canWithdraw: payload.canWithdraw, canDeposit: payload.canDeposit, accountType: payload.accountType, permissions };
  }

  async placeSpotBuy(request: ExchangeOrderRequest): Promise<ExchangeOrderResult> {
    const symbol = normalizeProviderSymbol(request.symbol, this.symbolMap);
    const normalizedRequest = { ...request, symbol };
    validateExchangeOrderRequest(normalizedRequest);
    if (!/^[A-Za-z0-9._:-]{1,36}$/.test(request.clientOrderId) || request.clientOrderId.length > MAX_CLIENT_ORDER_ID_LENGTH) throw new Error("INVALID_BINANCE_TESTNET_CLIENT_ORDER_ID");
    const { apiKey, apiSecret } = this.requireCredentials();
    const params = {
      symbol, side: "BUY", type: "MARKET", quoteOrderQty: request.amountUsd.toFixed(8),
      newClientOrderId: request.clientOrderId, newOrderRespType: "RESULT",
      recvWindow: this.recvWindow, timestamp: Date.now(),
    };
    const query = this.signedQuery(params, apiSecret);
    const response = await fetchWithProviderErrorMapping(this.fetcher, this.baseUrl + "/api/v3/order?" + query, {
      method: "POST",
      headers: { Accept: "application/json", "X-MBX-APIKEY": apiKey },
    });
    const payload = (await parseJson(response)) as BinanceOrderResponse;
    if (typeof payload.orderId !== "number" || typeof payload.clientOrderId !== "string" || typeof payload.status !== "string") {
      throw new Error("INVALID_BINANCE_TESTNET_ORDER_RESPONSE");
    }
    if (payload.status !== "FILLED") throw new Error("BINANCE_TESTNET_ORDER_NOT_FILLED");
    return { accepted: true, clientOrderId: payload.clientOrderId, providerOrderId: String(payload.orderId), status: "FILLED" };
  }
}