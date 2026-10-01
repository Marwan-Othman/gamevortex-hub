import { Prisma } from "@prisma/client";

export const TRADING_EXCHANGE_MODES = ["PAPER", "LIVE"] as const;
export type TradingExchangeMode = (typeof TRADING_EXCHANGE_MODES)[number];

export type ExchangeCapability =
  | "PUBLIC_MARKET_DATA"
  | "ACCOUNT_READ"
  | "SPOT_ORDERS"
  | "WITHDRAWALS";

export type ExchangeQuote = {
  symbol: string;
  bid: Prisma.Decimal;
  ask: Prisma.Decimal;
  last: Prisma.Decimal;
  timestamp: string;
  source: string;
};

export type ExchangeAccountSnapshot = {
  currency: string;
  available: Prisma.Decimal;
  locked: Prisma.Decimal;
};

/**
 * Phase 3 contract.
 *
 * Order execution is deliberately not part of the initial adapter surface.
 * The system must prove authentication, account isolation, and capability
 * restrictions before any live order method is exposed.
 */
export interface TradingExchangeAdapter {
  readonly id: string;
  readonly mode: TradingExchangeMode;

  getCapabilities(): readonly ExchangeCapability[];
  getQuote(symbol: string): Promise<ExchangeQuote>;
  getAccountSnapshot(): Promise<ExchangeAccountSnapshot[]>;
}

function normalizeSymbol(symbol: string): string {
  const value = symbol.trim().toUpperCase();
  if (!/^[A-Z0-9._-]{2,32}$/.test(value)) {
    throw new Error("INVALID_TRADING_SYMBOL");
  }
  return value;
}

/**
 * Safe default adapter. It intentionally never talks to a real exchange.
 * This keeps deployments and tests non-financial until the live adapter has
 * passed its security and operational gates.
 */
export class PaperTradingExchangeAdapter implements TradingExchangeAdapter {
  readonly id = "paper" as const;
  readonly mode = "PAPER" as const;

  getCapabilities(): readonly ExchangeCapability[] {
    return ["PUBLIC_MARKET_DATA"];
  }

  async getQuote(symbol: string): Promise<ExchangeQuote> {
    const normalized = normalizeSymbol(symbol);
    throw new Error(`PAPER_QUOTE_NOT_CONFIGURED:${normalized}`);
  }

  async getAccountSnapshot(): Promise<ExchangeAccountSnapshot[]> {
    return [];
  }
}
