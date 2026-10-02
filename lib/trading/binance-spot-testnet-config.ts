import { BinanceSpotTestnetAdapter } from "@/lib/trading/binance-spot-testnet-adapter";

/**
 * Server-only Binance Spot Testnet configuration.
 *
 * Credentials are read exclusively from server environment variables. Never
 * prefix these variables with NEXT_PUBLIC_ and never return them to callers.
 */
export function getBinanceSpotTestnetAdapter(): BinanceSpotTestnetAdapter {
  return new BinanceSpotTestnetAdapter({
    apiKey: process.env.BINANCE_TESTNET_API_KEY,
    apiSecret: process.env.BINANCE_TESTNET_API_SECRET,
  });
}

export function hasBinanceSpotTestnetCredentials(): boolean {
  return Boolean(
    process.env.BINANCE_TESTNET_API_KEY?.trim() &&
      process.env.BINANCE_TESTNET_API_SECRET?.trim(),
  );
}
