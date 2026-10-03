/**
 * Binance Spot symbol-rule validation for the GameVortex live boundary.
 *
 * This is a read-only exchangeInfo check. It does not place orders and it
 * never reads or writes private account data.
 */

const BINANCE_SPOT_BASE_URL = "https://api.binance.com";

type Fetcher = typeof fetch;

type BinanceFilter = {
  filterType?: string;
  minPrice?: string;
  maxPrice?: string;
  tickSize?: string;
  minQty?: string;
  maxQty?: string;
  stepSize?: string;
  minNotional?: string;
  applyToMarket?: boolean;
  applyMinToMarket?: boolean;
};

type BinanceExchangeSymbol = {
  symbol?: string;
  status?: string;
  baseAsset?: string;
  quoteAsset?: string;
  filters?: BinanceFilter[];
};

type BinanceExchangeInfo = {
  symbols?: BinanceExchangeSymbol[];
};

export type BinanceLiveSymbolRuleCheck = {
  symbol: string;
  quoteAsset: string;
  minNotional: number | null;
  tickSize: number | null;
  minQty: number | null;
  maxQty: number | null;
  stepSize: number | null;
};

function positive(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function assertPrice(value: number, rule: BinanceFilter | undefined, code: string): void {
  if (!rule || !Number.isFinite(value) || value <= 0) throw new Error(code);

  const min = positive(rule.minPrice);
  const max = positive(rule.maxPrice);
  const tick = positive(rule.tickSize);

  if (min !== null && value < min) throw new Error(code);
  if (max !== null && value > max) throw new Error(code);

  if (tick !== null) {
    const steps = value / tick;
    if (Math.abs(steps - Math.round(steps)) > 1e-8) throw new Error(code);
  }
}

function assertQuantity(value: number, rule: BinanceFilter | undefined, code: string): void {
  if (!rule || !Number.isFinite(value) || value <= 0) throw new Error(code);

  const min = positive(rule.minQty);
  const max = positive(rule.maxQty);
  const step = positive(rule.stepSize);

  if (min !== null && value < min) throw new Error(code);
  if (max !== null && value > max) throw new Error(code);

  if (step !== null && min !== null) {
    const steps = (value - min) / step;
    if (Math.abs(steps - Math.round(steps)) > 1e-8) throw new Error(code);
  }
}

export async function getBinanceLiveSymbolRules(
  symbol: string,
  fetcher: Fetcher = fetch,
): Promise<BinanceLiveSymbolRuleCheck> {
  const normalized = symbol.trim().toUpperCase().replaceAll("/", "");
  if (!/^[A-Z0-9]{1,20}$/.test(normalized)) throw new Error("INVALID_BINANCE_LIVE_SYMBOL");

  let response: Response;
  try {
    response = await fetcher(
      `${BINANCE_SPOT_BASE_URL}/api/v3/exchangeInfo?symbol=${encodeURIComponent(normalized)}`,
      { method: "GET", headers: { Accept: "application/json" } },
    );
  } catch {
    throw new Error("BINANCE_LIVE_SYMBOL_RULES_NETWORK_ERROR");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("BINANCE_LIVE_SYMBOL_RULES_INVALID_RESPONSE");
  }

  if (!response.ok) throw new Error("BINANCE_LIVE_SYMBOL_RULES_REQUEST_FAILED");
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as BinanceExchangeInfo).symbols)) {
    throw new Error("BINANCE_LIVE_SYMBOL_RULES_INVALID_RESPONSE");
  }

  const entry = (payload as BinanceExchangeInfo).symbols!.find((item) => item.symbol === normalized);
  if (!entry || entry.status !== "TRADING") throw new Error("BINANCE_LIVE_SYMBOL_NOT_TRADING");

  const filters = entry.filters ?? [];
  const priceFilter = filters.find((item) => item.filterType === "PRICE_FILTER");
  const marketLotSize = filters.find((item) => item.filterType === "MARKET_LOT_SIZE");
  const lotSize = filters.find((item) => item.filterType === "LOT_SIZE");
  const notional = filters.find((item) => item.filterType === "NOTIONAL");
  const minNotional = filters.find((item) => item.filterType === "MIN_NOTIONAL");

  return {
    symbol: normalized,
    quoteAsset: entry.quoteAsset ?? "",
    minNotional: positive(notional?.minNotional) ?? positive(minNotional?.minNotional),
    tickSize: positive(priceFilter?.tickSize),
    minQty: positive(marketLotSize?.minQty) ?? positive(lotSize?.minQty),
    maxQty: positive(marketLotSize?.maxQty) ?? positive(lotSize?.maxQty),
    stepSize: positive(marketLotSize?.stepSize) ?? positive(lotSize?.stepSize),
  };
}

export async function assertBinanceLiveBuyRules(input: {
  symbol: string;
  amountUsd: number;
  entryPrice: number;
  fetcher?: Fetcher;
}): Promise<BinanceLiveSymbolRuleCheck> {
  if (!Number.isFinite(input.amountUsd) || input.amountUsd <= 0) throw new Error("INVALID_BINANCE_LIVE_ORDER_AMOUNT");
  if (!Number.isFinite(input.entryPrice) || input.entryPrice <= 0) throw new Error("INVALID_BINANCE_LIVE_ENTRY_PRICE");

  const rules = await getBinanceLiveSymbolRules(input.symbol, input.fetcher);
  if (rules.minNotional !== null && input.amountUsd < rules.minNotional) {
    throw new Error(`BINANCE_LIVE_MIN_NOTIONAL:${rules.minNotional}`);
  }

  return rules;
}

export async function assertBinanceLiveProtectedExitRules(input: {
  symbol: string;
  quantity: number;
  takeProfitPrice: number;
  stopLossPrice: number;
  stopLimitPrice: number;
  fetcher?: Fetcher;
}): Promise<BinanceLiveSymbolRuleCheck> {
  const rules = await getBinanceLiveSymbolRules(input.symbol, input.fetcher);

  const quantityRule: BinanceFilter = {
    minQty: rules.minQty === null ? undefined : String(rules.minQty),
    maxQty: rules.maxQty === null ? undefined : String(rules.maxQty),
    stepSize: rules.stepSize === null ? undefined : String(rules.stepSize),
  };
  assertQuantity(input.quantity, quantityRule, "BINANCE_LIVE_EXIT_QUANTITY_FILTER_FAILED");

  const priceRule: BinanceFilter = { tickSize: rules.tickSize === null ? undefined : String(rules.tickSize) };
  assertPrice(input.takeProfitPrice, priceRule, "BINANCE_LIVE_TAKE_PROFIT_PRICE_FILTER_FAILED");
  assertPrice(input.stopLossPrice, priceRule, "BINANCE_LIVE_STOP_PRICE_FILTER_FAILED");
  assertPrice(input.stopLimitPrice, priceRule, "BINANCE_LIVE_STOP_LIMIT_PRICE_FILTER_FAILED");

  return rules;
}
