import type { ExchangeAdapter } from "@/lib/trading/exchange-adapter";
import { BinanceSpotLiveAdapter } from "@/lib/trading/binance-spot-live-adapter";
import { BybitSpotLiveAdapter } from "@/lib/trading/bybit-spot-live-adapter";

export type LiveExchangeId = "BINANCE" | "BYBIT";
export type LiveExchangeAdapter = ExchangeAdapter & {
  getOrderTradeFills: (request: { symbol: string; providerOrderId: string }) => Promise<{
    symbol: string;
    baseAsset: string;
    quoteAsset: string;
    fills: ReadonlyArray<{ qty: string; quoteQty: string; commission: string; commissionAsset: string }>;
  }>;
};

export function getConfiguredLiveExchange(value = process.env.GAMEVORTEX_LIVE_EXCHANGE): LiveExchangeId {
  const normalized = (value ?? "BINANCE").trim().toUpperCase();
  if (normalized !== "BINANCE" && normalized !== "BYBIT") throw new Error("INVALID_LIVE_EXCHANGE");
  return normalized;
}

export function createLiveExchangeAdapter(options: { fetcher?: typeof fetch } = {}): LiveExchangeAdapter {
  const exchange = getConfiguredLiveExchange();
  if (exchange === "BYBIT") {
    return new BybitSpotLiveAdapter({ fetcher: options.fetcher }) as LiveExchangeAdapter;
  }
  return new BinanceSpotLiveAdapter({
    apiKey: process.env.BINANCE_LIVE_API_KEY,
    apiSecret: process.env.BINANCE_LIVE_API_SECRET,
    apiPrivateKeyPem: process.env.BINANCE_LIVE_API_PRIVATE_KEY,
    fetcher: options.fetcher,
    liveTradingEnabled: process.env.GAMEVORTEX_LIVE_TRADING_ENABLED === "true",
  }) as LiveExchangeAdapter;
}
