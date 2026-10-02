/**
 * GameVortex AI Trading — exchange adapter contract.
 *
 * This module defines the boundary between the trading engine and an external
 * venue. Provider credentials and network calls stay inside provider adapters.
 * Live execution remains fail-closed and is separately gated by the live flag,
 * owner approval, Shariah checks, risk controls, reconciliation, and audit.
 */

import type { MarketCandle } from "@/lib/trading/market-data";
import type { LiveProviderOrderObservation } from "@/lib/trading/live-order-reconciliation";

export type ExchangeAdapterMode = "MARKET_DATA" | "PAPER" | "LIVE";

export type ExchangeAdapterCapabilities = {
  marketData: boolean;
  paperTrading: boolean;
  liveOrders: boolean;
  withdrawals: boolean;
  margin: boolean;
  leverage: boolean;
  shortSelling: boolean;
  derivatives: boolean;
};

export type ExchangeMarketDataRequest = {
  symbol: string;
  interval: string;
  limit: number;
};

export type ExchangeMarketDataResponse = {
  symbol: string;
  interval: string;
  candles: readonly MarketCandle[];
};

export type ExchangeOrderRequest = {
  clientOrderId: string;
  symbol: string;
  side: "BUY";
  amountUsd: number;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice?: number;
};

export type ExchangeOrderResult = {
  accepted: boolean;
  clientOrderId: string;
  providerOrderId?: string;
  status: "PAPER" | "REJECTED" | "SUBMITTED" | "FILLED";
  reason?: string;
  executedQty?: number;
  cumulativeQuoteQty?: number;
  averageFillPrice?: number;
};

export type ExchangeOrderStatusRequest = {
  symbol: string;
  clientOrderId: string;
};

export type ExchangeOrderStatusResult = {
  observation: LiveProviderOrderObservation;
};

export type ExchangeProtectedExitRequest = {
  symbol: string;
  quantity: string;
  takeProfitClientOrderId: string;
  takeProfitPrice: string;
  stopLossClientOrderId: string;
  stopLossPrice: string;
  stopLimitPrice: string;
  listClientOrderId?: string;
};

export type ExchangeProtectedExitResult = {
  accepted: boolean;
  orderListId: string;
  listClientOrderId: string;
  orders: Array<{
    providerOrderId: string;
    clientOrderId: string;
  }>;
  status: string;
};

export interface ExchangeAdapter {
  readonly id: string;
  readonly mode: ExchangeAdapterMode;
  readonly capabilities: ExchangeAdapterCapabilities;

  getMarketData(request: ExchangeMarketDataRequest): Promise<ExchangeMarketDataResponse>;

  placeSpotBuy?(request: ExchangeOrderRequest): Promise<ExchangeOrderResult>;

  /**
   * Query a provider order by the immutable client order id. A provider
   * adapter must normalize ambiguous/malformed responses instead of silently
   * treating them as a successful fill.
   */
  getOrderStatus?(request: ExchangeOrderStatusRequest): Promise<ExchangeOrderStatusResult>;

  /**
   * Submit the complete protective SELL OCO after a confirmed BUY fill.
   * This must never be implemented as two unrelated SELL orders because the
   * exchange-level OCO relationship is part of the safety invariant.
   */
  placeProtectedExitOco?(request: ExchangeProtectedExitRequest): Promise<ExchangeProtectedExitResult>;
}

/**
 * Validate the adapter identity/capability contract before it is registered.
 * This does not make an adapter live; it only verifies that its declared
 * contract is internally safe and deterministic.
 */
export function validateExchangeAdapterContract(adapter: ExchangeAdapter): void {
  if (!adapter.id.trim() || adapter.id.length > 64) {
    throw new Error("INVALID_EXCHANGE_ADAPTER_ID");
  }

  const capabilities = adapter.capabilities;
  for (const [key, value] of Object.entries(capabilities)) {
    if (typeof value !== "boolean") {
      throw new Error(`INVALID_EXCHANGE_CAPABILITY_${key.toUpperCase()}`);
    }
  }

  if (adapter.mode === "MARKET_DATA" && !capabilities.marketData) {
    throw new Error("MARKET_DATA_MODE_REQUIRES_MARKET_DATA");
  }

  if (adapter.mode === "PAPER" && !capabilities.paperTrading) {
    throw new Error("PAPER_MODE_REQUIRES_PAPER_TRADING");
  }
}

/**
 * Validate the market-data request at the exchange boundary.
 * This keeps malformed provider calls from escaping the application.
 */
export function validateExchangeMarketDataRequest(request: ExchangeMarketDataRequest): void {
  const symbol = request.symbol.trim().toUpperCase();
  if (!symbol || !/^[A-Z0-9._:-]{1,32}$/.test(symbol)) {
    throw new Error("INVALID_MARKET_DATA_SYMBOL");
  }

  const interval = request.interval.trim();
  if (!interval || interval.length > 32) {
    throw new Error("INVALID_MARKET_DATA_INTERVAL");
  }

  if (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > 1000) {
    throw new Error("INVALID_MARKET_DATA_LIMIT");
  }
}

/**
 * Validate the order contract before an adapter can receive a spot BUY.
 * This is deliberately fail-closed and does not contact a provider.
 */
export function validateExchangeOrderRequest(request: ExchangeOrderRequest): void {
  if (!request.clientOrderId.trim() || request.clientOrderId.length > 128) {
    throw new Error("INVALID_CLIENT_ORDER_ID");
  }

  const symbol = request.symbol.trim().toUpperCase();
  if (!symbol || !/^[A-Z0-9._:-]{1,32}$/.test(symbol)) {
    throw new Error("INVALID_ORDER_SYMBOL");
  }

  if (request.side !== "BUY") {
    throw new Error("SPOT_BUY_ONLY");
  }

  if (!Number.isFinite(request.amountUsd) || request.amountUsd < 1) {
    throw new Error("INVALID_ORDER_AMOUNT");
  }

  if (!Number.isFinite(request.entryPrice) || request.entryPrice <= 0) {
    throw new Error("INVALID_ORDER_ENTRY_PRICE");
  }

  if (!Number.isFinite(request.stopLossPrice) || request.stopLossPrice <= 0) {
    throw new Error("INVALID_ORDER_STOP_LOSS");
  }

  if (request.stopLossPrice >= request.entryPrice) {
    throw new Error("INVALID_ORDER_STOP_LOSS_FOR_BUY");
  }

  if (request.takeProfitPrice !== undefined) {
    if (!Number.isFinite(request.takeProfitPrice) || request.takeProfitPrice <= 0) {
      throw new Error("INVALID_ORDER_TAKE_PROFIT");
    }
    if (request.takeProfitPrice <= request.entryPrice) {
      throw new Error("INVALID_ORDER_TAKE_PROFIT_FOR_BUY");
    }
  }
}

/**
 * A provider is valid for live trading only if it explicitly advertises every
 * required live-safety capability. Paper-trading support is intentionally not
 * required here because paper trading is provided by a separate adapter.
 */
export function assertLiveAdapterCapability(adapter: ExchangeAdapter): void {
  validateExchangeAdapterContract(adapter);

  if (adapter.mode !== "LIVE") throw new Error("LIVE_ADAPTER_REQUIRED");
  if (!adapter.capabilities.marketData) throw new Error("MARKET_DATA_NOT_SUPPORTED");
  if (!adapter.capabilities.liveOrders) throw new Error("LIVE_ORDERS_NOT_SUPPORTED");
  if (adapter.capabilities.withdrawals) throw new Error("WITHDRAWALS_FORBIDDEN");
  if (adapter.capabilities.margin) throw new Error("MARGIN_FORBIDDEN");
  if (adapter.capabilities.leverage) throw new Error("LEVERAGE_FORBIDDEN");
  if (adapter.capabilities.shortSelling) throw new Error("SHORT_SELLING_FORBIDDEN");
  if (adapter.capabilities.derivatives) throw new Error("DERIVATIVES_FORBIDDEN");
  if (!adapter.placeSpotBuy) throw new Error("SPOT_BUY_ADAPTER_REQUIRED");
  if (!adapter.getOrderStatus) throw new Error("ORDER_STATUS_ADAPTER_REQUIRED");
  if (!adapter.placeProtectedExitOco) throw new Error("PROTECTED_EXIT_ADAPTER_REQUIRED");
}
