/**
 * GameVortex AI Trading — exchange adapter contract.
 *
 * This module defines the boundary between the trading engine and an external
 * venue. It intentionally contains no provider SDK, credentials, network calls,
 * or live-order implementation. A future adapter must satisfy this contract
 * and remain behind the existing owner approval, Shariah, risk, and execution
 * gates.
 *
 * LIVE execution remains disabled elsewhere until a separately reviewed
 * provider implementation exists.
 */

import type { MarketCandle } from "@/lib/trading/market-data";

export type ExchangeAdapterMode = "MARKET_DATA" | "PAPER" | "LIVE";

export type ExchangeAdapterCapabilities = {
  marketData: boolean;
  paperTrading: boolean;
  liveOrders: boolean;
  withdrawals: false;
  margin: false;
  leverage: false;
  shortSelling: false;
  derivatives: false;
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
  status: "PAPER" | "REJECTED" | "FILLED";
  reason?: string;
};

export interface ExchangeAdapter {
  readonly id: string;
  readonly mode: ExchangeAdapterMode;
  readonly capabilities: ExchangeAdapterCapabilities;

  getMarketData(request: ExchangeMarketDataRequest): Promise<ExchangeMarketDataResponse>;

  placeSpotBuy?(request: ExchangeOrderRequest): Promise<ExchangeOrderResult>;
}

/**
 * A provider is valid for live trading only if it explicitly advertises every
 * required capability. The function is deliberately strict and fail-closed.
 */
export function assertLiveAdapterCapability(adapter: ExchangeAdapter): void {
  if (adapter.mode !== "LIVE") throw new Error("LIVE_ADAPTER_REQUIRED");
  if (!adapter.capabilities.marketData) throw new Error("LIVE_MARKET_DATA_REQUIRED");
  if (!adapter.capabilities.liveOrders) throw new Error("LIVE_ORDERS_NOT_SUPPORTED");
  if (adapter.capabilities.withdrawals) throw new Error("WITHDRAWALS_FORBIDDEN");
  if (adapter.capabilities.margin) throw new Error("MARGIN_FORBIDDEN");
  if (adapter.capabilities.leverage) throw new Error("LEVERAGE_FORBIDDEN");
  if (adapter.capabilities.shortSelling) throw new Error("SHORT_SELLING_FORBIDDEN");
  if (adapter.capabilities.derivatives) throw new Error("DERIVATIVES_FORBIDDEN");
  if (!adapter.placeSpotBuy) throw new Error("SPOT_BUY_ADAPTER_REQUIRED");
}
