/**
 * GameVortex AI Trading — Binance Spot production adapter boundary.
 *
 * IMPORTANT SAFETY RULE:
 * This adapter is production-capable code but is fail-closed by default.
 * It cannot submit a live order unless GAMEVORTEX_LIVE_TRADING_ENABLED is
 * explicitly true at runtime. The application currently keeps that flag false.
 * Credentials are read server-side only and are never returned in results.
 *
 * This adapter implements the Binance Spot REST contract needed by the next
 * live-trading stage: market data, BUY submission, order-status lookup, and
 * protected SELL OCO submission. The executor/reconciliation layer remains
 * responsible for deciding when these methods may be called.
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
} from "@/lib/trading/exchange-adapter";
import type { LiveProviderOrderObservation } from "@/lib/trading/live-order-reconciliation";

const DEFAULT_BASE_URL = "https://api.binance.com";
const DEFAULT_RECV_WINDOW = 5_000;
const MAX_MARKET_DATA_LIMIT = 1_000;
const MAX_CLIENT_ORDER_ID_LENGTH = 36;

export type BinanceSpotLiveAdapterOptions = {
  apiKey?: string;
  apiSecret?: string;
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
  clientOrderId?: string;
  status?: string;
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

function normalizeBaseUrl(value: string | undefined): string {
  const baseUrl = (value ?? DEFAULT_BASE_URL).trim().replace(/\/$/, "");
  if (baseUrl !== DEFAULT_BASE_URL) {
    throw new Error("BINANCE_LIVE_BASE_URL_MUST_BE_OFFICIAL_PRODUCTION");
  }
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

function sign(query: string, secret: string): string {
  return createHmac("sha256", secret).update(query).digest("hex");
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
  const normalized = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) throw new Error(code);
  if (!Number.isFinite(Number(normalized)) || Number(normalized) <= 0) throw new Error(code);
  return normalized;
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

async function parseJson(response: Response): Promise<unknown> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("BINANCE_LIVE_INVALID_JSON_RESPONSE");
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "msg" in payload && typeof payload.msg === "string"
        ? payload.msg
        : `HTTP_${response.status}`;

    if (/restricted location|service unavailable from/i.test(message)) {
      throw new Error("BINANCE_LIVE_RESTRICTED_LOCATION");
    }

    throw new Error(`BINANCE_LIVE_${message}`);
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
  private readonly baseUrl: string;
  private readonly recvWindow: number;
  private readonly fetcher: typeof fetch;
  private readonly symbolMap: Readonly<Record<string, string>>;
  private readonly liveTradingEnabled: boolean;

  constructor(options: BinanceSpotLiveAdapterOptions = {}) {
    this.apiKey = options.apiKey?.trim() || undefined;
    this.apiSecret = options.apiSecret?.trim() || undefined;
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

  private requireCredentials(): { apiKey: string; apiSecret: string } {
    if (!this.apiKey || !this.apiSecret) throw new Error("BINANCE_LIVE_API_CREDENTIALS_REQUIRED");
    return { apiKey: this.apiKey, apiSecret: this.apiSecret };
  }

  private signedQuery(params: Record<string, string | number>, apiSecret: string): string {
    const query = encodeQuery(params);
    return `${query}&signature=${sign(query, apiSecret)}`;
  }

  private async signedRequest(
    method: "GET" | "POST",
    path: string,
    params: Record<string, string | number>,
  ): Promise<unknown> {
    const { apiKey, apiSecret } = this.requireCredentials();
    const query = this.signedQuery(params, apiSecret);
    const response = await this.fetcher(`${this.baseUrl}${path}?${query}`, {
      method,
      headers: {
        Accept: "application/json",
        "X-MBX-APIKEY": apiKey,
      },
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

    const executedQty = typeof payload.executedQty === "string" ? nonNegativeNumber(payload.executedQty, "BINANCE_LIVE_INVALID_EXECUTED_QTY") : undefined;
    const cumulativeQuoteQtyRaw = payload.cumulativeQuoteQty ?? payload.cummulativeQuoteQty;
    const cumulativeQuoteQty = typeof cumulativeQuoteQtyRaw === "string" ? nonNegativeNumber(cumulativeQuoteQtyRaw, "BINANCE_LIVE_INVALID_CUMULATIVE_QUOTE_QTY") : undefined;

    return {
      accepted: payload.status === "FILLED" || payload.status === "PARTIALLY_FILLED" || payload.status === "NEW",
      clientOrderId: payload.clientOrderId,
      providerOrderId: String(payload.orderId),
      status:
        payload.status === "FILLED"
          ? "FILLED"
          : payload.status === "REJECTED"
            ? "REJECTED"
            : "SUBMITTED",
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

    if (
      typeof payload.orderId !== "number" ||
      typeof payload.clientOrderId !== "string" ||
      typeof payload.symbol !== "string" ||
      typeof payload.status !== "string"
    ) {
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

  async placeProtectedExitOco(request: ExchangeProtectedExitRequest): Promise<ExchangeProtectedExitResult> {
    this.requireLiveExecution();
    const symbol = normalizeProviderSymbol(request.symbol, this.symbolMap);
    const quantity = assertPositiveDecimalText(request.quantity, "INVALID_BINANCE_LIVE_EXIT_QUANTITY");
    const takeProfitPrice = assertPositiveDecimalText(request.takeProfitPrice, "INVALID_BINANCE_LIVE_EXIT_TAKE_PROFIT");
    const stopLossPrice = assertPositiveDecimalText(request.stopLossPrice, "INVALID_BINANCE_LIVE_EXIT_STOP_LOSS");
    const stopLimitPrice = assertPositiveDecimalText(request.stopLimitPrice, "INVALID_BINANCE_LIVE_EXIT_STOP_LIMIT");
    const takeProfitClientOrderId = normalizeClientOrderId(request.takeProfitClientOrderId, "INVALID_BINANCE_LIVE_TP_CLIENT_ORDER_ID");
    const stopLossClientOrderId = normalizeClientOrderId(request.stopLossClientOrderId, "INVALID_BINANCE_LIVE_SL_CLIENT_ORDER_ID");
    const listClientOrderId = normalizeClientOrderId(
      request.listClientOrderId ?? stableListClientOrderId(takeProfitClientOrderId),
      "INVALID_BINANCE_LIVE_OCO_LIST_CLIENT_ORDER_ID",
    );

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

    if (
      typeof payload.orderListId !== "number" ||
      payload.contingencyType !== "OCO" ||
      typeof payload.listClientOrderId !== "string" ||
      !Array.isArray(payload.orders) ||
      payload.orders.length !== 2
    ) {
      throw new Error("BINANCE_LIVE_INVALID_OCO_RESPONSE");
    }

    const orderIds = payload.orders.map((order) => {
      if (typeof order.orderId !== "number" || typeof order.clientOrderId !== "string") {
        throw new Error("BINANCE_LIVE_INVALID_OCO_ORDER_RESPONSE");
      }
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
}
