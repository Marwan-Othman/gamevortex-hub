import { PaperTradingExchangeAdapter, TRADING_EXCHANGE_MODES, type TradingExchangeAdapter, type TradingExchangeMode } from "./exchange";

function readMode(): TradingExchangeMode {
  const raw = (process.env.TRADING_EXCHANGE_MODE ?? "PAPER").trim().toUpperCase();
  if (!TRADING_EXCHANGE_MODES.includes(raw as TradingExchangeMode)) {
    throw new Error("INVALID_TRADING_EXCHANGE_MODE");
  }
  return raw as TradingExchangeMode;
}

/**
 * Central trading integration gate.
 *
 * LIVE mode is intentionally fail-closed until the live exchange adapter,
 * credential isolation, no-withdraw capability check, and execution tests
 * are all implemented.
 */
export function getTradingExchangeConfig() {
  const mode = readMode();
  const liveRequested = process.env.TRADING_LIVE_ENABLED === "true";

  if (liveRequested || mode === "LIVE") {
    throw new Error("LIVE_TRADING_NOT_ENABLED");
  }

  return {
    mode: "PAPER" as const,
    provider: (process.env.TRADING_EXCHANGE ?? "PAPER").trim().toUpperCase(),
    liveTradingEnabled: false as const,
  };
}

export function getTradingExchangeAdapter(): TradingExchangeAdapter {
  const config = getTradingExchangeConfig();
  if (config.mode === "PAPER") return new PaperTradingExchangeAdapter();
  throw new Error("TRADING_EXCHANGE_ADAPTER_NOT_IMPLEMENTED");
}
