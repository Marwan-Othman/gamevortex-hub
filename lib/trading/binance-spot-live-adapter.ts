/**
 * GameVortex AI Trading — Binance Spot production adapter boundary.
 *
 * IMPORTANT SAFETY RULE:
 * This adapter is production-capable code but is fail-closed by default.
 * It cannot submit a live order unless GAMEVORTEX_LIVE_TRADING_ENABLED is
 * explicitly true at runtime. Credentials are read server-side only.
 *
 * Binance supports HMAC, RSA, and Ed25519 Spot API keys. GameVortex accepts
 * the existing BINANCE_LIVE_API_SECRET HMAC contract and the stronger
 * BINANCE_LIVE_API_PRIVATE_KEY Ed25519 contract. Ed25519 is preferred when
 * both are configured.
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
  type ExchangeOrderStatusRequest,
  type ExchangeOrderStatusResult,
  type ExchangeProtectedExitRequest,
  type ExchangeProtectedExitResult,
  type ExchangeProtectedExitLegStatusRequest,
  type ExchangeProtectedExitLegStatusResult,
} from "@/lib/trading/exchange-adapter";
import type { LiveProviderOrderObservation } from "@/lib/trading/live-order-reconciliation";
import { signBinancePayload } from "@/lib/trading/binance-signer";

const DEFAULT_BASE_URL = "https://api.binance.com";
const DEFAULT_RECV_WINDOW = 5_000;
const MAX_MARKET_DATA_LIMIT = 1_000;

export type BinanceSpotLiveAdapterOptions = {
  apiKey?: string;
  /** Classic Binance HMAC-SHA256 API secret. */
  apiSecret?: string;
  /** Optional Ed25519 PKCS#8 PEM private key; preferred when supplied. */
  apiPrivateKeyPem?: string;
  baseUrl?: string;
  recvWindow?: number;
  fetcher?: typeof fetch;
  symbolMap?: Readonly<Record<string, string>>;
  liveTradingEnabled?: boolean;
};

type BinanceKline = [number, string, string, string, string, string, number, string, number, string, string, string];

type BinanceOrderResponse = {
  symbol?: string;
  orderId?: number;
  orderListId?: number;
  clientOrderId?: string;
  status?: string;
  side?: string;
  executedQty?: string;
  cumulativeQuoteQty?: string;
  cummulativeQuoteQty?: string;
  transactTime?: number;
  updateTime?: number;
};

type BinanceOrderListResponse = {
  orderListId?: number;
  contingencyType?: string;
  listStatusType?: string;
  listOrderStatus?: string;
  listClientOrderId?: string;
  transactionTime?: number;
  symbol?: string;
  orders?: Array<{
    symbol?: string;
    orderId?: number;
    clientOrderId?: string;
  }>;
};

type BinanceExchangeInfoResponse = {
  symbols?: Array<{
    symbol?: string;
    status?: string;
    baseAsset?: string;
    quoteAsset?: string;
  }>;
};

type BinanceTradeResponse = {
  symbol?: string;
  id?: number;
  orderId?: number;
  price?: string;
  qty?: string;
  quoteQty?: string;
  commission?: string;
  commissionAsset?: string;
  time?: number;
  isBuyer?: boolean;
};

export type BinanceOrderTradeFill = {
  price: string;
  qty: string;
  quoteQty: string;
  commission: string;
  commissionAsset: string;
  time: number;
  isBuyer: boolean;
};

export type BinanceOrderTradeFills = {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  fills: readonly BinanceOrderTradeFill[];
};

function normalizeBaseUrl(value: string | undefined): string {
  const baseUrl = (value ?? DEFAULT_BASE_URL).trim().replace(/\/$/, "");
  if (baseUrl !== DEFAULT_BASE_URL) throw new Error("BINANCE_LIVE_BASE_URL_MUST_BE_OFFICIAL_PRODUCTION");
  return baseUrl;
}

function normalizeProviderSymbol(symbol: string, symbolMap: Readonly<Record<string, string>>): string {
  const normalized = symbol.trim().toUpperCase();
  const mapped = symbolMap[normalized] ?? normalized.replaceAll("/", "");
  if (!mapped || !/^[A-Z0-9]{1,20}$/.test(mapped)) throw new Error("INVALID_BINANCE_LIVE_SYMBOL");
  return mapped;
}

function positiveNumber(value: string, code: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(code);
  return parsed;
}

function nonNegativeNumber(value: string, code: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(code);
  return parsed;
}

function decimalText(value: string, code: string, allowZero = true): string {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) throw new Error(code);
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || (!allowZero && parsed <= 0) || (allowZero && parsed < 0)) throw new Error(code);
  return normalized;
}

function asset(value: string, code: string): string {
  const normalized = value.trim().toUpperCase();
  if (!normalized || !/^[A-Z0-9._:-]{1,32}$/.test(normalized)) throw new Error(code);
  return normalized;
}

function mapKline(kline: BinanceKline): MarketCandle {
  const [openTime, open, high, low, close, volume] = kline;
  return {
    timestamp: new Date(openTime).toISOString(),
    open: positiveNumber(open, "INVALID_BINANCE_LIVE_CANDLE"),
    high: positiveNumber(high, "INVALID_BINANCE_LIVE_CANDLE"),
    low: positiveNumber(low, "INVALID_BINANCE_LIVE_CANDLE"),
    close: positiveNumber(close, "INVALID_BINANCE_LIVE_CANDLE"),
    volume: positiveNumber(volume, "INVALID_BINANCE_LIVE_CANDLE"),
  };
}

function encodeQuery(params: Record<string, string | number>): string {
  return Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
}

function normalizeClientOrderId(value: string, code: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9._:-]{1,36}$/.test(normalized)) throw new Error(code);
  return normalized;
}

function stableListClientOrderId(entryClientOrderId: string): string {
  const digest = createHmac("sha256", "gamevortex-oco-list-id").update(entryClientOrderId, "utf8").digest("hex");
  return `gv-oco-${digest.slice(0, 24)}`;
}

function assertPositiveDecimalText(value: string, code: string): string {
  return decimalText(value, code, false);
}

function mapProviderStatus(status: string | undefined): LiveProviderOrderObservation["status"] {
  switch (status) {
    case "NEW":
    case "PENDING_NEW":
    case "PARTIALLY_FILLED":
    case "FILLED":
    case "CANCELED":
    case "REJECTED":
    case "EXPIRED":
    case "PENDING_CANCEL":
      return status;
    default:
      return "UNKNOWN";
  }
}

function mapExitLegStatus(status: string | undefined): ExchangeProtectedExitLegStatusResult["status"] {
  switch (status) {
    case "NEW":
    case "PARTIALLY_FILLED":
    case "FILLED":
    case "CANCELED":
    case "REJECTED":
    case "EXPIRED":
    case "PENDING_CANCEL":
      return status;
    default:
      return "UNKNOWN";
  }
}

async function parseJson(response: Response): Promise<unknown> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("BINANCE_LIVE_INVALID_JSON_RESPONSE");
  }

  if (!response.ok) {
    const object = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : undefined;
    const message = typeof object?.msg === "string" ? object.msg : `HTTP_${response.status}`;
    const normalized = message.toLowerCase();
    const code = typeof object?.code === "number" ? object.code : Number(object?.code);
    if (/restricted location|service unavailable from/i.test(message)) throw new Error("BINANCE_LIVE_RESTRICTED_LOCATION");
    if (response.status === 401 || code === -1002 || code === -2015 || normalized.includes("invalid api-key") || normalized.includes("invalid api key")) {
      throw new Error("BINANCE_LIVE_API_AUTH_FAILED");
    }
    if (code === -1021 || normalized.includes("recvwindow") || normalized.includes("timestamp")) throw new Error("BINANCE_LIVE_TIMESTAMP_INVALID");
    if (code === -1022 || normalized.includes("signature")) throw new Error("BINANCE_LIVE_SIGNATURE_INVALID");
    if (response.status === 429 || response.status === 418 || code === -1003 || normalized.includes("too many requests")) throw new Error("BINANCE_LIVE_RATE_LIMITED");
    if (response.status >= 500 && response.status <= 599) throw new Error("BINANCE_LIVE_PROVIDER_ERROR");
    throw new Error("BINANCE_LIVE_PROVIDER_ERROR");
  }

  return payload;
}

export class BinanceSpotLiveAdapter implements ExchangeAdapter {
  readonly id = "binance-spot-live";
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
  private readonly apiPrivateKeyPem?: string;
  private readonly baseUrl: string;
  private readonly recvWindow: number;
  private readonly fetcher: typeof fetch;
  private readonly symbolMap: Readonly<Record<string, string>>;
  private readonly liveTradingEnabled: boolean;

  constructor(options: BinanceSpotLiveAdapterOptions = {}) {
    this.apiKey = options.apiKey?.trim() || undefined;
    this.apiSecret = options.apiSecret?.trim() || undefined;
    this.apiPrivateKeyPem = options.apiPrivateKeyPem?.trim() || undefined;
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.recvWindow = options.recvWindow ?? DEFAULT_RECV_WINDOW;
    this.fetcher = options.fetcher ?? fetch;
    this.symbolMap = Object.fromEntries(
      Object.entries(options.symbolMap ?? {}).map(([key, value]) => [key.trim().toUpperCase(), value.trim().toUpperCase()]),
    );
    this.liveTradingEnabled = options.liveTradingEnabled ?? process.env.GAMEVORTEX_LIVE_TRADING_ENABLED === "true";

    if (!Number.isInteger(this.recvWindow) || this.recvWindow < 1 || this.recvWindow > 60_000) {
      throw new Error("INVALID_BINANCE_LIVE_RECV_WINDOW");
    }
  }

  private requireLiveExecution(): void {
    if (!this.liveTradingEnabled) throw new Error("LIVE_TRADING_DISABLED");
  }

  private requireCredentials(): { apiKey: string; apiPrivateKeyPem?: string; apiSecret?: string } {
    if (!this.apiKey || (!this.apiPrivateKeyPem && !this.apiSecret)) throw new Error("BINANCE_LIVE_API_CREDENTIALS_REQUIRED");
    return { apiKey: this.apiKey, apiPrivateKeyPem: this.apiPrivateKeyPem, apiSecret: this.apiSecret };
  }

  private signedQuery(
    params: Record<string, string | number>,
    credentials: { apiPrivateKeyPem?: string; apiSecret?: string },
  ): string {
    const query = encodeQuery(params);
    const signature = signBinancePayload(query, credentials);
    return `${query}&signature=${encodeURIComponent(signature)}`;
  }

  private async signedRequest(method: "GET" | "POST", path: string, params: Record<string, string | number>): Promise<unknown> {
    const { apiKey, apiPrivateKeyPem, apiSecret } = this.requireCredentials();
    const query = this.signedQuery(params, { apiPrivateKeyPem, apiSecret });
    const response = await this.fetcher(`${this.baseUrl}${path}?${query}`, {
      method,
      headers: { Accept: "application/json", "X-MBX-APIKEY": apiKey },
    });
    return parseJson(response);
  }

  async getMarketData(request: ExchangeMarketDataRequest): Promise<ExchangeMarketDataResponse> {
    validateExchangeMarketDataRequest(request);
    if (request.limit > MAX_MARKET_DATA_LIMIT) throw new Error("INVALID_MARKET_DATA_LIMIT");
    const symbol = normalizeProviderSymbol(request.symbol, this.symbolMap);
    const query = encodeQuery({ symbol, interval: request.interval.trim(), limit: request.limit });
    const response = await this.fetcher(`${this.baseUrl}/api/v3/klines?${query}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    const payload = await parseJson(response);
    if (!Array.isArray(payload)) throw new Error("INVALID_BINANCE_LIVE_KLINES_RESPONSE");
    const candles = payload.map((item) => {
      if (!Array.isArray(item) || item.length < 6) throw new Error("INVALID_BINANCE_LIVE_KLINE");
      return mapKline(item as BinanceKline);
    });
    return { symbol, interval: request.interval.trim(), candles };
  }

  async placeSpotBuy(request: ExchangeOrderRequest): Promise<ExchangeOrderResult> {
    this.requireLiveExecution();
    validateExchangeOrderRequest(request);
    const clientOrderId = normalizeClientOrderId(request.clientOrderId, "INVALID_BINANCE_LIVE_CLIENT_ORDER_ID");
    const symbol = normalizeProviderSymbol(request.symbol, this.symbolMap);
    const payload = (await this.signedRequest("POST", "/api/v3/order", {
      symbol,
      side: "BUY",
      type: "MARKET",
      quoteOrderQty: request.amountUsd.toFixed(8),
      newClientOrderId: clientOrderId,
      newOrderRespType: "FULL",
      recvWindow: this.recvWindow,
      timestamp: Date.now(),
    })) as BinanceOrderResponse;

    if (typeof payload.orderId !== "number" || typeof payload.clientOrderId !== "string" || typeof payload.status !== "string") {
      throw new Error("BINANCE_LIVE_INVALID_ORDER_RESPONSE");
    }

    const executedQty = typeof payload.executedQty === "string"
      ? nonNegativeNumber(payload.executedQty, "BINANCE_LIVE_INVALID_EXECUTED_QTY")
      : undefined;
    const cumulativeQuoteQtyRaw = payload.cumulativeQuoteQty ?? payload.cummulativeQuoteQty;
    const cumulativeQuoteQty = typeof cumulativeQuoteQtyRaw === "string"
      ? nonNegativeNumber(cumulativeQuoteQtyRaw, "BINANCE_LIVE_INVALID_CUMULATIVE_QUOTE_QTY")
      : undefined;

    return {
      accepted: payload.status === "FILLED" || payload.status === "PARTIALLY_FILLED" || payload.status === "NEW",
      clientOrderId: payload.clientOrderId,
      providerOrderId: String(payload.orderId),
      status: payload.status === "FILLED" ? "FILLED" : payload.status === "REJECTED" ? "REJECTED" : "SUBMITTED",
      executedQty,
      cumulativeQuoteQty,
      averageFillPrice:
        executedQty !== undefined && executedQty > 0 && cumulativeQuoteQty !== undefined
          ? cumulativeQuoteQty / executedQty
          : undefined,
    };
  }

  async getOrderStatus(request: ExchangeOrderStatusRequest): Promise<ExchangeOrderStatusResult> {
    this.requireLiveExecution();
    const symbol = normalizeProviderSymbol(request.symbol, this.symbolMap);
    const clientOrderId = normalizeClientOrderId(request.clientOrderId, "INVALID_BINANCE_LIVE_CLIENT_ORDER_ID");
    const payload = (await this.signedRequest("GET", "/api/v3/order", {
      symbol,
      origClientOrderId: clientOrderId,
      recvWindow: this.recvWindow,
      timestamp: Date.now(),
    })) as BinanceOrderResponse;

    if (typeof payload.orderId !== "number" || typeof payload.clientOrderId !== "string" || typeof payload.symbol !== "string" || typeof payload.status !== "string") {
      throw new Error("BINANCE_LIVE_INVALID_ORDER_STATUS_RESPONSE");
    }

    const executedQty = typeof payload.executedQty === "string" ? nonNegativeNumber(payload.executedQty, "BINANCE_LIVE_INVALID_EXECUTED_QTY") : 0;
    const cumulativeQuoteQtyRaw = payload.cumulativeQuoteQty ?? payload.cummulativeQuoteQty;
    const cumulativeQuoteQty = typeof cumulativeQuoteQtyRaw === "string" ? nonNegativeNumber(cumulativeQuoteQtyRaw, "BINANCE_LIVE_INVALID_CUMULATIVE_QUOTE_QTY") : 0;
    const averageFillPrice = executedQty > 0 ? cumulativeQuoteQty / executedQty : undefined;
    const updatedAt = payload.updateTime ?? payload.transactTime;
    if (typeof updatedAt !== "number" || !Number.isFinite(updatedAt)) throw new Error("BINANCE_LIVE_INVALID_ORDER_UPDATE_TIME");

    return {
      observation: {
        clientOrderId: payload.clientOrderId,
        providerOrderId: String(payload.orderId),
        symbol: payload.symbol,
        side: "BUY",
        status: mapProviderStatus(payload.status),
        executedQty,
        cumulativeQuoteQty,
        averageFillPrice,
        updatedAt,
      },
    };
  }

  async getOrderTradeFills(request: { symbol: string; providerOrderId: string }): Promise<BinanceOrderTradeFills> {
    this.requireLiveExecution();
    const symbol = normalizeProviderSymbol(request.symbol, this.symbolMap);
    const orderId = Number(request.providerOrderId.trim());
    if (!Number.isSafeInteger(orderId) || orderId <= 0) throw new Error("INVALID_BINANCE_LIVE_PROVIDER_ORDER_ID");

    const exchangeInfoQuery = encodeQuery({ symbol });
    const exchangeInfoResponse = await this.fetcher(`${this.baseUrl}/api/v3/exchangeInfo?${exchangeInfoQuery}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    const exchangeInfo = (await parseJson(exchangeInfoResponse)) as BinanceExchangeInfoResponse;
    const symbolInfo = exchangeInfo.symbols?.find((item) => item.symbol === symbol);
    if (!symbolInfo || typeof symbolInfo.baseAsset !== "string" || typeof symbolInfo.quoteAsset !== "string") {
      throw new Error("BINANCE_LIVE_SYMBOL_ASSET_INFO_REQUIRED");
    }

    const payload = (await this.signedRequest("GET", "/api/v3/myTrades", {
      symbol,
      orderId,
      limit: 1_000,
      recvWindow: this.recvWindow,
      timestamp: Date.now(),
    })) as unknown;

    if (!Array.isArray(payload)) throw new Error("BINANCE_LIVE_INVALID_TRADE_FILLS_RESPONSE");

    const fills = (payload as BinanceTradeResponse[]).map((fill) => {
      if (
        typeof fill.orderId !== "number" ||
        fill.orderId !== orderId ||
        typeof fill.price !== "string" ||
        typeof fill.qty !== "string" ||
        typeof fill.quoteQty !== "string" ||
        typeof fill.commission !== "string" ||
        typeof fill.commissionAsset !== "string" ||
        typeof fill.time !== "number" ||
        typeof fill.isBuyer !== "boolean"
      ) {
        throw new Error("BINANCE_LIVE_INVALID_TRADE_FILL");
      }

      return {
        price: decimalText(fill.price, "BINANCE_LIVE_INVALID_TRADE_PRICE", false),
        qty: decimalText(fill.qty, "BINANCE_LIVE_INVALID_TRADE_QTY", false),
        quoteQty: decimalText(fill.quoteQty, "BINANCE_LIVE_INVALID_TRADE_QUOTE_QTY", false),
        commission: decimalText(fill.commission, "BINANCE_LIVE_INVALID_TRADE_COMMISSION"),
        commissionAsset: asset(fill.commissionAsset, "BINANCE_LIVE_INVALID_TRADE_COMMISSION_ASSET"),
        time: fill.time,
        isBuyer: fill.isBuyer,
      } satisfies BinanceOrderTradeFill;
    });

    if (fills.length === 0) throw new Error("BINANCE_LIVE_TRADE_FILLS_REQUIRED");

    return {
      symbol,
      baseAsset: asset(symbolInfo.baseAsset, "BINANCE_LIVE_INVALID_BASE_ASSET"),
      quoteAsset: asset(symbolInfo.quoteAsset, "BINANCE_LIVE_INVALID_QUOTE_ASSET"),
      fills,
    };
  }

  async placeProtectedExitOco(request: ExchangeProtectedExitRequest): Promise<ExchangeProtectedExitResult> {
    this.requireLiveExecution();
    const symbol = normalizeProviderSymbol(request.symbol, this.symbolMap);
    const quantity = assertPositiveDecimalText(request.quantity, "INVALID_BINANCE_LIVE_EXIT_QUANTITY");
    const entryPrice = assertPositiveDecimalText(request.entryPrice, "INVALID_BINANCE_LIVE_ENTRY_PRICE");
    const takeProfitPrice = assertPositiveDecimalText(request.takeProfitPrice, "INVALID_BINANCE_LIVE_EXIT_TAKE_PROFIT");
    const stopLossPrice = assertPositiveDecimalText(request.stopLossPrice, "INVALID_BINANCE_LIVE_EXIT_STOP_LOSS");
    const stopLimitPrice = assertPositiveDecimalText(request.stopLimitPrice, "INVALID_BINANCE_LIVE_EXIT_STOP_LIMIT");
    const takeProfitClientOrderId = normalizeClientOrderId(request.takeProfitClientOrderId, "INVALID_BINANCE_LIVE_TP_CLIENT_ORDER_ID");
    const stopLossClientOrderId = normalizeClientOrderId(request.stopLossClientOrderId, "INVALID_BINANCE_LIVE_SL_CLIENT_ORDER_ID");
    const listClientOrderId = normalizeClientOrderId(request.listClientOrderId ?? stableListClientOrderId(takeProfitClientOrderId), "INVALID_BINANCE_LIVE_OCO_LIST_CLIENT_ORDER_ID");

    if (!(takeProfitPrice > entryPrice && entryPrice > stopLossPrice && stopLossPrice > stopLimitPrice)) {
      throw new Error("INVALID_BINANCE_LIVE_PROTECTED_EXIT_PRICE_ORDER");
    }

    const payload = (await this.signedRequest("POST", "/api/v3/orderList/oco", {
      symbol,
      side: "SELL",
      quantity,
      listClientOrderId,
      aboveType: "LIMIT_MAKER",
      aboveClientOrderId: takeProfitClientOrderId,
      abovePrice: takeProfitPrice,
      belowType: "STOP_LOSS_LIMIT",
      belowClientOrderId: stopLossClientOrderId,
      belowPrice: stopLimitPrice,
      belowStopPrice: stopLossPrice,
      belowTimeInForce: "GTC",
      newOrderRespType: "RESULT",
      recvWindow: this.recvWindow,
      timestamp: Date.now(),
    })) as BinanceOrderListResponse;

    if (typeof payload.orderListId !== "number" || payload.contingencyType !== "OCO" || typeof payload.listClientOrderId !== "string" || !Array.isArray(payload.orders) || payload.orders.length !== 2) {
      throw new Error("BINANCE_LIVE_INVALID_OCO_RESPONSE");
    }

    const orderIds = payload.orders.map((order) => {
      if (typeof order.orderId !== "number" || typeof order.clientOrderId !== "string") throw new Error("BINANCE_LIVE_INVALID_OCO_ORDER_RESPONSE");
      return { providerOrderId: String(order.orderId), clientOrderId: order.clientOrderId };
    });

    const clientOrderIds = new Set(orderIds.map((order) => order.clientOrderId));
    if (!clientOrderIds.has(takeProfitClientOrderId) || !clientOrderIds.has(stopLossClientOrderId)) {
      throw new Error("BINANCE_LIVE_OCO_CLIENT_ORDER_ID_MISMATCH");
    }

    return {
      accepted: true,
      orderListId: String(payload.orderListId),
      listClientOrderId: payload.listClientOrderId,
      orders: orderIds,
      status: payload.listOrderStatus ?? "UNKNOWN",
    };
  }

  async getProtectedExitLegStatus(request: ExchangeProtectedExitLegStatusRequest): Promise<ExchangeProtectedExitLegStatusResult> {
    this.requireLiveExecution();
    const symbol = normalizeProviderSymbol(request.symbol, this.symbolMap);
    const clientOrderId = normalizeClientOrderId(request.clientOrderId, "INVALID_BINANCE_LIVE_EXIT_CLIENT_ORDER_ID");
    const payload = (await this.signedRequest("GET", "/api/v3/order", {
      symbol,
      origClientOrderId: clientOrderId,
      recvWindow: this.recvWindow,
      timestamp: Date.now(),
    })) as BinanceOrderResponse;

    if (typeof payload.orderId !== "number" || typeof payload.clientOrderId !== "string" || typeof payload.symbol !== "string" || typeof payload.status !== "string" || payload.side !== "SELL") {
      throw new Error("BINANCE_LIVE_INVALID_EXIT_ORDER_RESPONSE");
    }

    const executedQty = typeof payload.executedQty === "string" ? nonNegativeNumber(payload.executedQty, "BINANCE_LIVE_INVALID_EXIT_EXECUTED_QTY") : 0;
    const cumulativeQuoteQtyRaw = payload.cumulativeQuoteQty ?? payload.cummulativeQuoteQty;
    const cumulativeQuoteQty = typeof cumulativeQuoteQtyRaw === "string" ? nonNegativeNumber(cumulativeQuoteQtyRaw, "BINANCE_LIVE_INVALID_EXIT_CUMULATIVE_QUOTE_QTY") : 0;
    const averageFillPrice = executedQty > 0 ? cumulativeQuoteQty / executedQty : null;
    const updatedAt = payload.updateTime ?? payload.transactTime;
    if (typeof updatedAt !== "number" || !Number.isFinite(updatedAt)) throw new Error("BINANCE_LIVE_INVALID_EXIT_UPDATE_TIME");

    return {
      symbol: payload.symbol,
      clientOrderId: payload.clientOrderId,
      providerOrderId: String(payload.orderId),
      orderListId: typeof payload.orderListId === "number" && payload.orderListId >= 0 ? String(payload.orderListId) : null,
      side: "SELL",
      status: mapExitLegStatus(payload.status),
      executedQty: String(executedQty),
      cumulativeQuoteQty: String(cumulativeQuoteQty),
      averageFillPrice: averageFillPrice === null ? null : String(averageFillPrice),
      updatedAt: new Date(updatedAt),
    };
  }
}
