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

  /** Read-only account/API-key preflight. This never submits or changes an order. */
  async getLiveReadiness(quoteAssetInput = "USDT"): Promise<{
    accountMode: number;
    marginMode: string;
    quoteAsset: string;
    quoteFreeBalance: number;
    blockers: string[];
  }> {
    const quoteAsset = quoteAssetInput.trim().toUpperCase();
    if (!/^[A-Z0-9]{2,12}$/.test(quoteAsset)) throw new Error("BYBIT_LIVE_INVALID_QUOTE_ASSET");
    const keyResult = objectResult(await this.request("GET", "/v5/user/query-api", {}), "BYBIT_LIVE_API_KEY_INFO_REQUIRED");
    if (typeof keyResult.apiKey !== "string" || keyResult.apiKey !== this.apiKey) throw new Error("BYBIT_LIVE_API_KEY_IDENTITY_MISMATCH");
    if (keyResult.readOnly !== 0 || !keyResult.permissions || typeof keyResult.permissions !== "object" || Array.isArray(keyResult.permissions)) throw new Error("BYBIT_LIVE_API_KEY_NOT_TRADING_ENABLED");
    const permissions = keyResult.permissions as Record<string, unknown>;
    const requiredArray = (name: string): string[] => {
      const value = permissions[name];
      if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error("BYBIT_LIVE_API_PERMISSIONS_INVALID");
      return value as string[];
    };
    if (!requiredArray("Spot").includes("SpotTrade")) throw new Error("BYBIT_LIVE_SPOT_PERMISSION_REQUIRED");
    const walletPermissions = requiredArray("Wallet");
    if (walletPermissions.some((permission) => ["Withdraw", "AccountTransfer", "SubMemberTransfer"].includes(permission))) throw new Error("BYBIT_LIVE_WITHDRAW_OR_TRANSFER_PERMISSION_FORBIDDEN");
    if (requiredArray("ContractTrade").length || requiredArray("Options").length || requiredArray("Derivatives").length) throw new Error("BYBIT_LIVE_NON_SPOT_PERMISSION_FORBIDDEN");
    const accountResult = objectResult(await this.request("GET", "/v5/account/info", {}), "BYBIT_LIVE_ACCOUNT_INFO_REQUIRED");
    const accountMode = accountResult.unifiedMarginStatus;
    const marginMode = typeof accountResult.marginMode === "string" ? accountResult.marginMode : "";
    if (typeof accountMode !== "number" || ![3, 4, 5, 6].includes(accountMode) || !marginMode) throw new Error("BYBIT_LIVE_ACCOUNT_MODE_UNVERIFIED");
    const walletResult = objectResult(await this.request("GET", "/v5/account/wallet-balance", { accountType: "UNIFIED", coin: quoteAsset }), "BYBIT_LIVE_WALLET_BALANCE_REQUIRED");
    if (!Array.isArray(walletResult.list) || walletResult.list.length !== 1 || !walletResult.list[0] || typeof walletResult.list[0] !== "object") throw new Error("BYBIT_LIVE_WALLET_BALANCE_INVALID");
    const account = walletResult.list[0] as Record<string, unknown>;
    if (account.accountType !== "UNIFIED" || !Array.isArray(account.coin)) throw new Error("BYBIT_LIVE_WALLET_BALANCE_INVALID");
    const coin = account.coin.find((item) => item && typeof item === "object" && (item as Record<string, unknown>).coin === quoteAsset) as Record<string, unknown> | undefined;
    if (!coin) return { accountMode, marginMode, quoteAsset, quoteFreeBalance: 0, blockers: ["BYBIT_LIVE_QUOTE_BALANCE_ZERO"] };
    const walletBalance = Number(coin.walletBalance);
    const locked = Number(coin.locked);
    const spotBorrow = Number(coin.spotBorrow ?? "0");
    if (![walletBalance, locked, spotBorrow].every((value) => Number.isFinite(value) && value >= 0)) throw new Error("BYBIT_LIVE_WALLET_BALANCE_INVALID");
    if (spotBorrow > 0) throw new Error("BYBIT_LIVE_SPOT_BORROW_DETECTED");
    const quoteFreeBalance = Math.max(0, walletBalance - locked);
    return { accountMode, marginMode, quoteAsset, quoteFreeBalance, blockers: quoteFreeBalance > 0 ? [] : ["BYBIT_LIVE_QUOTE_BALANCE_ZERO"] };
  }
  async getSpotSymbolRules(symbolInput: string): Promise<{
    symbol: string;
    baseAsset: string;
    quoteAsset: string;
    minOrderQty: string;
    maxOrderQty: string;
    qtyStep: string;
    minOrderAmount: string;
    tickSize: string;
  }> {
    const symbol = normalizeSymbol(symbolInput, this.symbolMap);
    let response: Response;
    try {
      response = await this.fetcher(
        `${this.baseUrl}/v5/market/instruments-info?${encodeQuery({ category: "spot", symbol })}`,
        { method: "GET", headers: { Accept: "application/json" } },
      );
    } catch {
      throw new Error("BYBIT_LIVE_SYMBOL_RULES_NETWORK_ERROR");
    }
    const payload = await parseResponse(response);
    const result = objectResult(payload, "BYBIT_LIVE_INVALID_INSTRUMENT_RESPONSE");
    if (!Array.isArray(result.list) || result.list.length !== 1 || !result.list[0] || typeof result.list[0] !== "object") {
      throw new Error("BYBIT_LIVE_SYMBOL_RULES_MISSING");
    }
    const instrument = result.list[0] as Record<string, unknown>;
    const lot = instrument.lotSizeFilter;
    const price = instrument.priceFilter;
    if (instrument.symbol !== symbol || instrument.status !== "Trading" || typeof instrument.baseCoin !== "string" || typeof instrument.quoteCoin !== "string" || !lot || typeof lot !== "object" || !price || typeof price !== "object") {
      throw new Error("BYBIT_LIVE_SYMBOL_RULES_INVALID");
    }
    const lotFilter = lot as Record<string, unknown>;
    const priceFilter = price as Record<string, unknown>;
    const baseAsset = instrument.baseCoin.trim().toUpperCase();
    const quoteAsset = instrument.quoteCoin.trim().toUpperCase();
    const minOrderQty = typeof lotFilter.minOrderQty === "string" ? lotFilter.minOrderQty : "";
    const maxOrderQty = typeof lotFilter.maxOrderQty === "string" ? lotFilter.maxOrderQty : "";
    const qtyStep = typeof lotFilter.qtyStep === "string" ? lotFilter.qtyStep : "";
    const minOrderAmount = typeof lotFilter.minOrderAmt === "string" ? lotFilter.minOrderAmt : "";
    const tickSize = typeof priceFilter.tickSize === "string" ? priceFilter.tickSize : "";
    for (const value of [minOrderQty, maxOrderQty, qtyStep, tickSize]) positive(value, "BYBIT_LIVE_SYMBOL_RULES_INVALID");
    nonNegative(minOrderAmount, "BYBIT_LIVE_SYMBOL_RULES_INVALID");
    if (!baseAsset || !quoteAsset || Number(maxOrderQty) < Number(minOrderQty)) throw new Error("BYBIT_LIVE_SYMBOL_RULES_INVALID");
    return { symbol, baseAsset, quoteAsset, minOrderQty, maxOrderQty, qtyStep, minOrderAmount, tickSize };
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

  async getOrderTradeFills(request: { symbol: string; providerOrderId: string }): Promise<{
    symbol: string;
    baseAsset: string;
    quoteAsset: string;
    fills: ReadonlyArray<{ qty: string; quoteQty: string; commission: string; commissionAsset: string }>;
  }> {
    this.requireLive();
    const symbol = normalizeSymbol(request.symbol, this.symbolMap);
    const orderId = request.providerOrderId.trim();
    if (!/^[A-Za-z0-9-]{8,80}$/.test(orderId)) throw new Error("INVALID_BYBIT_LIVE_PROVIDER_ORDER_ID");
    const instrumentResponse = await this.fetcher(`${this.baseUrl}/v5/market/instruments-info?${encodeQuery({ category: "spot", symbol })}`, { method: "GET", headers: { Accept: "application/json" } });
    const instrumentPayload = await parseResponse(instrumentResponse);
    const instrumentResult = objectResult(instrumentPayload, "BYBIT_LIVE_INVALID_INSTRUMENT_RESPONSE");
    const instruments = instrumentResult.list;
    const instrument = Array.isArray(instruments) && instruments[0] && typeof instruments[0] === "object" ? instruments[0] as Record<string, unknown> : undefined;
    const baseAsset = typeof instrument?.baseCoin === "string" ? instrument.baseCoin.trim().toUpperCase() : "";
    const quoteAsset = typeof instrument?.quoteCoin === "string" ? instrument.quoteCoin.trim().toUpperCase() : "";
    if (!baseAsset || !quoteAsset) throw new Error("BYBIT_LIVE_SYMBOL_ASSET_INFO_REQUIRED");
    const payload = await this.request("GET", "/v5/execution/list", { category: "spot", orderId, limit: 100 });
    const result = objectResult(payload, "BYBIT_LIVE_INVALID_TRADE_FILLS_RESPONSE");
    const list = result.list;
    if (!Array.isArray(list) || list.length === 0) throw new Error("BYBIT_LIVE_TRADE_FILLS_REQUIRED");
    const fills = list.map((item) => {
      if (!item || typeof item !== "object") throw new Error("BYBIT_LIVE_INVALID_TRADE_FILL");
      const fill = item as Record<string, unknown>;
      const qty = typeof fill.execQty === "string" ? decimal(fill.execQty, "BYBIT_LIVE_INVALID_TRADE_QTY", false) : "";
      const quoteQty = typeof fill.execValue === "string" ? decimal(fill.execValue, "BYBIT_LIVE_INVALID_TRADE_QUOTE_QTY", false) : "";
      const commission = typeof fill.execFee === "string" ? decimal(fill.execFee, "BYBIT_LIVE_INVALID_TRADE_COMMISSION") : "";
      const commissionAsset = typeof fill.feeCurrency === "string" ? fill.feeCurrency.trim().toUpperCase() : "";
      if (!qty || !quoteQty || !commission || !/^[A-Z0-9._:-]{1,32}$/.test(commissionAsset)) throw new Error("BYBIT_LIVE_INVALID_TRADE_FILL");
      return { qty, quoteQty, commission, commissionAsset };
    });
    return { symbol, baseAsset, quoteAsset, fills };
  }

  async placeProtectedExitOco(_request: ExchangeProtectedExitRequest): Promise<ExchangeProtectedExitResult> {
    this.requireLive();

    // The current Bybit implementation would submit two independent full-size
    // conditional SELL orders. They are not an atomic OCO pair, so one leg
    // filling may leave the other leg active and create an unintended short/
    // rejected oversell attempt. Do not submit either leg until a verified
    // provider-native linked TP/SL implementation and reconciliation exist.
    throw new Error("BYBIT_NATIVE_LINKED_PROTECTION_NOT_IMPLEMENTED");
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
