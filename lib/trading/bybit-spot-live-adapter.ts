/**
 * GameVortex Trading — Bybit V5 Spot production adapter.
 *
 * Credentials are server-only. The adapter is fail-closed unless
 * GAMEVORTEX_LIVE_TRADING_ENABLED is explicitly true. It is limited to
 * non-margin Spot operations: no withdrawals, leverage, short selling or
 * derivatives.
 */

import { createHmac } from "node:crypto";
import type { MarketCandle } from "@/lib/trading/market-data";
import {
  validateExchangeMarketDataRequest,
  validateExchangeOrderRequest,
  type ExchangeAdapter,
  type ExchangeEmergencySellRequest,
  type ExchangeEmergencySellResult,
  type ExchangeMarketDataRequest,
  type ExchangeMarketDataResponse,
  type ExchangeOrderRequest,
  type ExchangeOrderResult,
  type ExchangeOrderStatusRequest,
  type ExchangeOrderStatusResult,
  type ExchangeProtectedExitRequest,
  type ExchangeProtectedExitResult,
  type ExchangeProtectedExitLegStatusRequest,
  type ExchangeProtectedExitLegStatusResult,
} from "@/lib/trading/exchange-adapter";
import type { LiveProviderOrderObservation } from "@/lib/trading/live-order-reconciliation";

const MAINNET_BASE_URL = "https://api.bybit.com";
const TESTNET_BASE_URL = "https://api-testnet.bybit.com";
const DEFAULT_RECV_WINDOW = 5_000;
const MAX_MARKET_DATA_LIMIT = 1_000;

type BybitFetcher = typeof fetch;

type BybitSpotLiveAdapterOptions = {
  apiKey?: string;
  apiSecret?: string;
  baseUrl?: string;
  recvWindow?: number;
  fetcher?: BybitFetcher;
  symbolMap?: Readonly<Record<string, string>>;
  liveTradingEnabled?: boolean;
};

type BybitResponse = {
  retCode?: number;
  retMsg?: string;
  result?: unknown;
  time?: number;
};

type BybitOrder = {
  orderId?: string;
  orderLinkId?: string;
  symbol?: string;
  side?: string;
  orderStatus?: string;
  avgPrice?: string;
  cumExecQty?: string;
  cumExecValue?: string;
  createdTime?: string;
  updatedTime?: string;
};

function officialBaseUrl(value: string | undefined): string {
  const baseUrl = (value ?? process.env.BYBIT_LIVE_BASE_URL ?? MAINNET_BASE_URL).trim().replace(/\/$/, "");
  if (baseUrl !== MAINNET_BASE_URL && baseUrl !== TESTNET_BASE_URL) {
    throw new Error("BYBIT_LIVE_BASE_URL_MUST_BE_OFFICIAL");
  }
  return baseUrl;
}

function normalizeSymbol(value: string, map: Readonly<Record<string, string>>): string {
  const normalized = value.trim().toUpperCase();
  const mapped = map[normalized] ?? normalized.replaceAll("/", "");
  if (!/^[A-Z0-9]{1,20}$/.test(mapped)) throw new Error("INVALID_BYBIT_LIVE_SYMBOL");
  return mapped;
}

function normalizeClientOrderId(value: string, code: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9._:-]{1,36}$/.test(normalized)) throw new Error(code);
  return normalized;
}

function decimal(value: string, code: string, allowZero = true): string {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) throw new Error(code);
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || (!allowZero && parsed <= 0) || (allowZero && parsed < 0)) throw new Error(code);
  return normalized;
}

function positive(value: string, code: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(code);
  return parsed;
}

function nonNegative(value: string, code: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(code);
  return parsed;
}

function encodeQuery(params: Record<string, string | number>): string {
  return Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
}

function mapStatus(value: string | undefined): LiveProviderOrderObservation["status"] {
  switch (value) {
    case "New": return "NEW";
    case "PartiallyFilled": return "PARTIALLY_FILLED";
    case "Filled": return "FILLED";
    case "Cancelled":
    case "Deactivated": return "CANCELED";
    case "Rejected": return "REJECTED";
    case "PendingCancel": return "PENDING_CANCEL";
    default: return "UNKNOWN";
  }
}

function mapExitStatus(value: string | undefined): ExchangeProtectedExitLegStatusResult["status"] {
  switch (value) {
    case "New": return "NEW";
    case "PartiallyFilled": return "PARTIALLY_FILLED";
    case "Filled": return "FILLED";
    case "Cancelled":
    case "Deactivated": return "CANCELED";
    case "Rejected": return "REJECTED";
    case "PendingCancel": return "PENDING_CANCEL";
    default: return "UNKNOWN";
  }
}

function mapCandle(item: unknown): MarketCandle {
  if (!Array.isArray(item) || item.length < 6) throw new Error("INVALID_BYBIT_LIVE_KLINE");
  const timestamp = Number(item[0]);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) throw new Error("INVALID_BYBIT_LIVE_CANDLE");
  return {
    timestamp: new Date(timestamp).toISOString(),
    open: positive(String(item[1]), "INVALID_BYBIT_LIVE_CANDLE"),
    high: positive(String(item[2]), "INVALID_BYBIT_LIVE_CANDLE"),
    low: positive(String(item[3]), "INVALID_BYBIT_LIVE_CANDLE"),
    close: positive(String(item[4]), "INVALID_BYBIT_LIVE_CANDLE"),
    volume: positive(String(item[5]), "INVALID_BYBIT_LIVE_CANDLE"),
  };
}

function objectResult(payload: BybitResponse, code: string): Record<string, unknown> {
  if (payload.retCode !== 0 || !payload.result || typeof payload.result !== "object") throw new Error(code);
  return payload.result as Record<string, unknown>;
}

async function parseResponse(response: Response): Promise<BybitResponse> {
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new Error("BYBIT_LIVE_INVALID_JSON_RESPONSE"); }
  if (!response.ok) {
    const object = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const message = typeof object.retMsg === "string" ? object.retMsg : `HTTP_${response.status}`;
    const lower = message.toLowerCase();
    if (response.status === 403 || lower.includes("restricted") || lower.includes("country")) throw new Error("BYBIT_LIVE_RESTRICTED_LOCATION");
    if (response.status === 401 || lower.includes("api key") || lower.includes("signature") || lower.includes("permission")) throw new Error("BYBIT_LIVE_API_AUTH_FAILED");
    if (response.status === 429 || lower.includes("too many") || lower.includes("rate")) throw new Error("BYBIT_LIVE_RATE_LIMITED");
    throw new Error("BYBIT_LIVE_PROVIDER_ERROR");
  }
  if (!payload || typeof payload !== "object") throw new Error("BYBIT_LIVE_INVALID_JSON_RESPONSE");
  const body = payload as BybitResponse;
  if (body.retCode !== 0) {
    const msg = String(body.retMsg ?? "").toLowerCase();
    if (msg.includes("timestamp") || msg.includes("recv_window") || body.retCode === 10002) throw new Error("BYBIT_LIVE_TIMESTAMP_INVALID");
    if (msg.includes("sign") || msg.includes("api key") || msg.includes("permission") || body.retCode === 10003 || body.retCode === 10004) throw new Error("BYBIT_LIVE_API_AUTH_FAILED");
    if (body.retCode === 10006 || msg.includes("rate")) throw new Error("BYBIT_LIVE_RATE_LIMITED");
    throw new Error("BYBIT_LIVE_PROVIDER_ERROR");
  }
  return body;
}

export class BybitSpotLiveAdapter implements ExchangeAdapter {
  readonly id = "bybit-spot-live";
  readonly mode = "LIVE" as const;
  readonly capabilities = {
    marketData: true,
    paperTrading: false,
    liveOrders: true,
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
  private readonly fetcher: BybitFetcher;
  private readonly symbolMap: Readonly<Record<string, string>>;
  private readonly liveTradingEnabled: boolean;

  constructor(options: BybitSpotLiveAdapterOptions = {}) {
    this.apiKey = options.apiKey?.trim() || process.env.BYBIT_LIVE_API_KEY?.trim() || undefined;
    this.apiSecret = options.apiSecret?.trim() || process.env.BYBIT_LIVE_API_SECRET?.trim() || undefined;
    this.baseUrl = officialBaseUrl(options.baseUrl);
    this.recvWindow = options.recvWindow ?? DEFAULT_RECV_WINDOW;
    this.fetcher = options.fetcher ?? fetch;
    this.symbolMap = Object.fromEntries(Object.entries(options.symbolMap ?? {}).map(([key, value]) => [key.trim().toUpperCase(), value.trim().toUpperCase()]));
    this.liveTradingEnabled = options.liveTradingEnabled ?? process.env.GAMEVORTEX_LIVE_TRADING_ENABLED === "true";
    if (!Number.isInteger(this.recvWindow) || this.recvWindow < 1 || this.recvWindow > 60_000) throw new Error("INVALID_BYBIT_LIVE_RECV_WINDOW");
  }

  private requireLive(): void { if (!this.liveTradingEnabled) throw new Error("LIVE_TRADING_DISABLED"); }

  private credentials(): { apiKey: string; apiSecret: string } {
    if (!this.apiKey || !this.apiSecret) throw new Error("BYBIT_LIVE_API_CREDENTIALS_REQUIRED");
    return { apiKey: this.apiKey, apiSecret: this.apiSecret };
  }

  private async request(method: "GET" | "POST", path: string, params: Record<string, string | number>): Promise<BybitResponse> {
    const { apiKey, apiSecret } = this.credentials();
    const timestamp = String(Date.now());
    const recvWindow = String(this.recvWindow);
    const body = method === "POST" ? JSON.stringify(params) : "";
    const query = method === "GET" ? encodeQuery(params) : "";
    const signingPayload = `${timestamp}${apiKey}${recvWindow}${method === "GET" ? query : body}`;
    const signature = createHmac("sha256", apiSecret).update(signingPayload).digest("hex");
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-BAPI-API-KEY": apiKey,
      "X-BAPI-TIMESTAMP": timestamp,
      "X-BAPI-RECV-WINDOW": recvWindow,
      "X-BAPI-SIGN": signature,
    };
    const url = `${this.baseUrl}${path}${method === "GET" ? `?${query}` : ""}`;
    const response = await this.fetcher(url, { method, headers, ...(method === "POST" ? { body } : {}) });
    return parseResponse(response);
  }

  async getMarketData(request: ExchangeMarketDataRequest): Promise<ExchangeMarketDataResponse> {
    validateExchangeMarketDataRequest(request);
    if (request.limit > MAX_MARKET_DATA_LIMIT) throw new Error("INVALID_MARKET_DATA_LIMIT");
    const symbol = normalizeSymbol(request.symbol, this.symbolMap);
    const response = await this.fetcher(`${this.baseUrl}/v5/market/kline?${encodeQuery({ category: "spot", symbol, interval: request.interval.trim(), limit: request.limit, ...(request.endTimeMs ? { end: request.endTimeMs } : {}) })}`, { method: "GET", headers: { Accept: "application/json" } });
    const payload = await parseResponse(response);
    const result = objectResult(payload, "BYBIT_LIVE_INVALID_KLINES_RESPONSE");
    const list = result.list;
    if (!Array.isArray(list)) throw new Error("BYBIT_LIVE_INVALID_KLINES_RESPONSE");
    const candles = list.map(mapCandle).reverse();
    return { symbol, interval: request.interval.trim(), candles };
  }

  async placeSpotBuy(request: ExchangeOrderRequest): Promise<ExchangeOrderResult> {
    this.requireLive();
    validateExchangeOrderRequest(request);
    const symbol = normalizeSymbol(request.symbol, this.symbolMap);
    const clientOrderId = normalizeClientOrderId(request.clientOrderId, "INVALID_BYBIT_LIVE_CLIENT_ORDER_ID");
    const payload = await this.request("POST", "/v5/order/create", {
      category: "spot", symbol, side: "Buy", orderType: "Market", qty: request.amountUsd.toFixed(8), marketUnit: "quoteCoin", timeInForce: "IOC", orderLinkId: clientOrderId, isLeverage: 0, orderFilter: "Order",
    });
    const result = objectResult(payload, "BYBIT_LIVE_INVALID_ORDER_RESPONSE");
    const orderId = typeof result.orderId === "string" ? result.orderId : "";
    const returnedLinkId = typeof result.orderLinkId === "string" && result.orderLinkId ? result.orderLinkId : clientOrderId;
    if (!orderId) throw new Error("BYBIT_LIVE_PROVIDER_ORDER_ID_REQUIRED");
    return { accepted: true, clientOrderId: returnedLinkId, providerOrderId: orderId, status: "SUBMITTED" };
  }

  async placeEmergencyMarketSell(request: ExchangeEmergencySellRequest): Promise<ExchangeEmergencySellResult> {
    this.requireLive();
    const symbol = normalizeSymbol(request.symbol, this.symbolMap);
    const clientOrderId = normalizeClientOrderId(request.clientOrderId, "INVALID_BYBIT_LIVE_CLIENT_ORDER_ID");
    const quantity = decimal(request.quantity, "INVALID_BYBIT_LIVE_EMERGENCY_SELL_QUANTITY", false);
    const payload = await this.request("POST", "/v5/order/create", {
      category: "spot", symbol, side: "Sell", orderType: "Market", qty: quantity, marketUnit: "baseCoin", timeInForce: "IOC", orderLinkId: clientOrderId, isLeverage: 0, orderFilter: "Order",
    });
    const result = objectResult(payload, "BYBIT_LIVE_INVALID_ORDER_RESPONSE");
    const orderId = typeof result.orderId === "string" ? result.orderId : "";
    if (!orderId) throw new Error("BYBIT_LIVE_PROVIDER_ORDER_ID_REQUIRED");
    return { accepted: true, clientOrderId, providerOrderId: orderId, status: "SUBMITTED" };
  }

  async getOrderStatus(request: ExchangeOrderStatusRequest): Promise<ExchangeOrderStatusResult> {
    this.requireLive();
    const symbol = normalizeSymbol(request.symbol, this.symbolMap);
    const clientOrderId = normalizeClientOrderId(request.clientOrderId, "INVALID_BYBIT_LIVE_CLIENT_ORDER_ID");
    const payload = await this.request("GET", "/v5/order/realtime", { category: "spot", orderLinkId: clientOrderId, limit: 1 });
    const result = objectResult(payload, "BYBIT_LIVE_INVALID_ORDER_STATUS_RESPONSE");
    const list = result.list;
    if (!Array.isArray(list) || !list[0] || typeof list[0] !== "object") throw new Error("BYBIT_LIVE_ORDER_NOT_FOUND");
    const order = list[0] as BybitOrder;
    if (typeof order.orderId !== "string" || typeof order.orderLinkId !== "string" || typeof order.symbol !== "string" || typeof order.side !== "string" || typeof order.orderStatus !== "string") throw new Error("BYBIT_LIVE_INVALID_ORDER_STATUS_RESPONSE");
    const executedQty = typeof order.cumExecQty === "string" ? nonNegative(order.cumExecQty, "BYBIT_LIVE_INVALID_EXECUTED_QTY") : 0;
    const cumulativeQuoteQty = typeof order.cumExecValue === "string" ? nonNegative(order.cumExecValue, "BYBIT_LIVE_INVALID_CUMULATIVE_QUOTE_QTY") : 0;
    const updatedAt = Number(order.updatedTime ?? order.createdTime);
    if (!Number.isSafeInteger(updatedAt) || updatedAt <= 0) throw new Error("BYBIT_LIVE_INVALID_ORDER_UPDATE_TIME");
    if (order.side !== "Buy") throw new Error("BYBIT_LIVE_ORDER_SIDE_MISMATCH");
    return { observation: { clientOrderId: order.orderLinkId, providerOrderId: order.orderId, symbol: order.symbol, side: "BUY", status: mapStatus(order.orderStatus), executedQty, cumulativeQuoteQty, averageFillPrice: typeof order.avgPrice === "string" && Number(order.avgPrice) > 0 ? Number(order.avgPrice) : undefined, updatedAt } };
  }

  async placeProtectedExitOco(request: ExchangeProtectedExitRequest): Promise<ExchangeProtectedExitResult> {
    this.requireLive();
    const symbol = normalizeSymbol(request.symbol, this.symbolMap);
    const quantity = decimal(request.quantity, "INVALID_BYBIT_LIVE_EXIT_QUANTITY", false);
    const entryPrice = positive(request.entryPrice, "INVALID_BYBIT_LIVE_ENTRY_PRICE");
    const takeProfitPrice = positive(request.takeProfitPrice, "INVALID_BYBIT_LIVE_EXIT_TAKE_PROFIT");
    const stopLossPrice = positive(request.stopLossPrice, "INVALID_BYBIT_LIVE_EXIT_STOP_LOSS");
    const stopLimitPrice = positive(request.stopLimitPrice, "INVALID_BYBIT_LIVE_EXIT_STOP_LIMIT");
    const takeProfitClientOrderId = normalizeClientOrderId(request.takeProfitClientOrderId, "INVALID_BYBIT_LIVE_TP_CLIENT_ORDER_ID");
    const stopLossClientOrderId = normalizeClientOrderId(request.stopLossClientOrderId, "INVALID_BYBIT_LIVE_SL_CLIENT_ORDER_ID");
    if (!(takeProfitPrice > entryPrice && entryPrice > stopLossPrice && stopLossPrice > stopLimitPrice)) throw new Error("INVALID_BYBIT_LIVE_PROTECTED_EXIT_PRICE_ORDER");

    // Bybit Spot exposes TP/SL as two linked conditional orders rather than
    // Binance's single OCO list. Both are submitted as server-side orders;
    // if the second request fails, the caller must execute its emergency exit.
    const common = { category: "spot", symbol, side: "Sell", orderType: "Limit", qty: quantity, timeInForce: "GTC", isLeverage: 0, orderFilter: "tpslOrder" };
    const tp = await this.request("POST", "/v5/order/create", { ...common, price: takeProfitPrice.toString(), triggerPrice: takeProfitPrice.toString(), orderLinkId: takeProfitClientOrderId, tpOrderType: "Limit", tpLimitPrice: takeProfitPrice.toString() });
    const tpResult = objectResult(tp, "BYBIT_LIVE_TP_SUBMISSION_FAILED");
    const tpId = typeof tpResult.orderId === "string" ? tpResult.orderId : "";
    if (!tpId) throw new Error("BYBIT_LIVE_TP_ORDER_ID_REQUIRED");
    const sl = await this.request("POST", "/v5/order/create", { ...common, price: stopLimitPrice.toString(), triggerPrice: stopLossPrice.toString(), orderLinkId: stopLossClientOrderId, slOrderType: "Limit", slLimitPrice: stopLimitPrice.toString() });
    const slResult = objectResult(sl, "BYBIT_LIVE_SL_SUBMISSION_FAILED");
    const slId = typeof slResult.orderId === "string" ? slResult.orderId : "";
    if (!slId) throw new Error("BYBIT_LIVE_SL_ORDER_ID_REQUIRED");
    return { accepted: true, orderListId: `bybit-pair:${tpId}:${slId}`, listClientOrderId: request.listClientOrderId ?? `bybit-pair:${takeProfitClientOrderId}`, orders: [{ providerOrderId: tpId, clientOrderId: takeProfitClientOrderId }, { providerOrderId: slId, clientOrderId: stopLossClientOrderId }], status: "New" };
  }

  async getProtectedExitLegStatus(request: ExchangeProtectedExitLegStatusRequest): Promise<ExchangeProtectedExitLegStatusResult> {
    this.requireLive();
    const symbol = normalizeSymbol(request.symbol, this.symbolMap);
    const clientOrderId = normalizeClientOrderId(request.clientOrderId, "INVALID_BYBIT_LIVE_EXIT_CLIENT_ORDER_ID");
    const payload = await this.request("GET", "/v5/order/realtime", { category: "spot", orderLinkId: clientOrderId, limit: 1 });
    const result = objectResult(payload, "BYBIT_LIVE_INVALID_EXIT_STATUS_RESPONSE");
    const list = result.list;
    if (!Array.isArray(list) || !list[0] || typeof list[0] !== "object") throw new Error("BYBIT_LIVE_EXIT_ORDER_NOT_FOUND");
    const order = list[0] as BybitOrder;
    if (typeof order.orderId !== "string" || typeof order.orderLinkId !== "string" || typeof order.symbol !== "string" || typeof order.orderStatus !== "string") throw new Error("BYBIT_LIVE_INVALID_EXIT_STATUS_RESPONSE");
    const updatedAt = Number(order.updatedTime ?? order.createdTime);
    if (!Number.isSafeInteger(updatedAt) || updatedAt <= 0) throw new Error("BYBIT_LIVE_INVALID_EXIT_UPDATE_TIME");
    return { symbol: order.symbol, clientOrderId: order.orderLinkId, providerOrderId: order.orderId, orderListId: null, side: "SELL", status: mapExitStatus(order.orderStatus), executedQty: typeof order.cumExecQty === "string" ? decimal(order.cumExecQty, "BYBIT_LIVE_INVALID_EXIT_EXECUTED_QTY") : "0", cumulativeQuoteQty: typeof order.cumExecValue === "string" ? decimal(order.cumExecValue, "BYBIT_LIVE_INVALID_EXIT_CUMULATIVE_QUOTE_QTY") : "0", averageFillPrice: typeof order.avgPrice === "string" && Number(order.avgPrice) > 0 ? order.avgPrice : null, updatedAt: new Date(updatedAt) };
  }
}
