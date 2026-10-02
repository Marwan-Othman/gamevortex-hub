import { createHash } from "node:crypto";

export type ProtectedExitPlanInput = {
  symbol: string;
  entryClientOrderId: string;
  filledQuantity: string | number;
  entryPrice: string | number;
  takeProfitPrice: string | number;
  stopLossPrice: string | number;
  stopLimitPrice: string | number;
};

export type ProtectedExitPlan = {
  contingencyType: "OCO";
  symbol: string;
  side: "SELL";
  quantity: string;
  takeProfit: {
    clientOrderId: string;
    type: "LIMIT_MAKER";
    price: string;
  };
  stopLoss: {
    clientOrderId: string;
    type: "STOP_LOSS_LIMIT";
    price: string;
    stopPrice: string;
  };
};

function normalizePositiveDecimal(value: string | number, code: string): string {
  const text = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) throw new Error(code);
  const numeric = Number(text);
  if (!Number.isFinite(numeric) || numeric <= 0) throw new Error(code);
  return text;
}

function compare(left: string, right: string): number {
  const a = Number(left);
  const b = Number(right);
  if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error("INVALID_EXIT_DECIMAL");
  return a === b ? 0 : a > b ? 1 : -1;
}

function normalizeSymbol(symbol: string): string {
  const normalized = symbol.trim().toUpperCase();
  if (!/^[A-Z0-9._:-]{1,32}$/.test(normalized)) throw new Error("INVALID_EXIT_SYMBOL");
  return normalized;
}

function normalizeClientOrderId(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 128) throw new Error("INVALID_EXIT_ENTRY_CLIENT_ORDER_ID");
  return normalized;
}

function childClientOrderId(entryClientOrderId: string, leg: "tp" | "sl"): string {
  const digest = createHash("sha256").update(`${entryClientOrderId}:${leg}`, "utf8").digest("hex");
  return `gv-exit-${leg}-${digest.slice(0, 20)}`;
}

/**
 * Build the protected exit orders that must exist after a confirmed BUY fill.
 * No exchange call is made here. A production adapter must submit and verify
 * the complete OCO before the live position can be considered protected.
 */
export function buildProtectedExitPlan(input: ProtectedExitPlanInput): ProtectedExitPlan {
  const symbol = normalizeSymbol(input.symbol);
  const entryClientOrderId = normalizeClientOrderId(input.entryClientOrderId);
  const quantity = normalizePositiveDecimal(input.filledQuantity, "INVALID_EXIT_QUANTITY");
  const entryPrice = normalizePositiveDecimal(input.entryPrice, "INVALID_EXIT_ENTRY_PRICE");
  const takeProfitPrice = normalizePositiveDecimal(input.takeProfitPrice, "INVALID_EXIT_TAKE_PROFIT");
  const stopLossPrice = normalizePositiveDecimal(input.stopLossPrice, "INVALID_EXIT_STOP_LOSS");
  const stopLimitPrice = normalizePositiveDecimal(input.stopLimitPrice, "INVALID_EXIT_STOP_LIMIT");

  if (compare(takeProfitPrice, entryPrice) <= 0) {
    throw new Error("INVALID_EXIT_TAKE_PROFIT_FOR_BUY");
  }
  if (compare(entryPrice, stopLossPrice) <= 0) {
    throw new Error("INVALID_EXIT_STOP_LOSS_FOR_BUY");
  }
  if (compare(stopLossPrice, stopLimitPrice) <= 0) {
    throw new Error("INVALID_EXIT_STOP_LIMIT_FOR_SELL");
  }

  return {
    contingencyType: "OCO",
    symbol,
    side: "SELL",
    quantity,
    takeProfit: {
      clientOrderId: childClientOrderId(entryClientOrderId, "tp"),
      type: "LIMIT_MAKER",
      price: takeProfitPrice,
    },
    stopLoss: {
      clientOrderId: childClientOrderId(entryClientOrderId, "sl"),
      type: "STOP_LOSS_LIMIT",
      price: stopLimitPrice,
      stopPrice: stopLossPrice,
    },
  };
}
