/**
 * GameVortex AI Trading — paper position lifecycle primitives.
 *
 * This module is deliberately side-effect free. It does not touch wallets,
 * databases, exchange APIs, or credentials. It defines the invariants that a
 * future persistent position service must preserve.
 *
 * Current trading scope:
 * - spot BUY positions only;
 * - minimum position amount: $1;
 * - mandatory stop-loss;
 * - optional take-profit;
 * - no margin, leverage, short selling, or withdrawals.
 */

export type PaperPositionStatus = "OPEN" | "CLOSED";

export type PaperPosition = {
  positionId: string;
  symbol: string;
  side: "BUY";
  amountUsd: number;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice?: number;
  openedAt: string;
  status: PaperPositionStatus;
  closedAt?: string;
  exitPrice?: number;
  exitReason?: PaperPositionExitReason;
  pnlUsd?: number;
  returnPercent?: number;
  shariahPolicyVersion: string;
};

export type PaperPositionExitReason =
  | "STOP_LOSS"
  | "TAKE_PROFIT"
  | "MANUAL"
  | "END_OF_DATA";

export type PaperPositionExit = {
  reason: "STOP_LOSS" | "TAKE_PROFIT";
  price: number;
};

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function normalizeSymbol(symbol: string): string {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized || !/^[A-Z0-9._:\/-]{1,32}$/.test(normalized)) {
    throw new Error("INVALID_POSITION_SYMBOL");
  }
  return normalized;
}

function normalizeId(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 200) throw new Error(code);
  return normalized;
}

function normalizeTimestamp(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized || Number.isNaN(Date.parse(normalized))) throw new Error(code);
  return normalized;
}

function normalizePolicyVersion(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 100) {
    throw new Error("INVALID_POSITION_SHARIAH_POLICY_VERSION");
  }
  return normalized;
}

function normalizeExitReason(value: PaperPositionExitReason): PaperPositionExitReason {
  if (
    value !== "STOP_LOSS" &&
    value !== "TAKE_PROFIT" &&
    value !== "MANUAL" &&
    value !== "END_OF_DATA"
  ) {
    throw new Error("INVALID_POSITION_EXIT_REASON");
  }
  return value;
}

export function openPaperPosition(input: {
  positionId: string;
  symbol: string;
  amountUsd: number;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice?: number;
  openedAt: string;
  shariahPolicyVersion: string;
}): PaperPosition {
  const positionId = normalizeId(input.positionId, "INVALID_POSITION_ID");
  const symbol = normalizeSymbol(input.symbol);
  const openedAt = normalizeTimestamp(input.openedAt, "INVALID_POSITION_OPEN_TIME");
  const shariahPolicyVersion = normalizePolicyVersion(input.shariahPolicyVersion);

  if (!positiveFinite(input.amountUsd) || input.amountUsd < 1) {
    throw new Error("INVALID_POSITION_AMOUNT");
  }
  if (!positiveFinite(input.entryPrice) || !positiveFinite(input.stopLossPrice)) {
    throw new Error("INVALID_POSITION_PRICES");
  }
  if (input.stopLossPrice >= input.entryPrice) {
    throw new Error("INVALID_POSITION_STOP_LOSS_FOR_BUY");
  }
  if (input.takeProfitPrice !== undefined) {
    if (!positiveFinite(input.takeProfitPrice) || input.takeProfitPrice <= input.entryPrice) {
      throw new Error("INVALID_POSITION_TAKE_PROFIT_FOR_BUY");
    }
  }

  return {
    positionId,
    symbol,
    side: "BUY",
    amountUsd: input.amountUsd,
    entryPrice: input.entryPrice,
    stopLossPrice: input.stopLossPrice,
    takeProfitPrice: input.takeProfitPrice,
    openedAt,
    status: "OPEN",
    shariahPolicyVersion,
  };
}

export function evaluatePaperPositionExit(
  position: PaperPosition,
  currentPrice: number,
): PaperPositionExit | undefined {
  if (position.status !== "OPEN") throw new Error("POSITION_NOT_OPEN");
  if (!positiveFinite(currentPrice)) throw new Error("INVALID_POSITION_MARKET_PRICE");

  if (currentPrice <= position.stopLossPrice) {
    return { reason: "STOP_LOSS", price: position.stopLossPrice };
  }

  if (position.takeProfitPrice !== undefined && currentPrice >= position.takeProfitPrice) {
    return { reason: "TAKE_PROFIT", price: position.takeProfitPrice };
  }

  return undefined;
}

export function closePaperPosition(
  position: PaperPosition,
  input: {
    exitPrice: number;
    reason: PaperPositionExitReason;
    closedAt: string;
  },
): PaperPosition {
  if (position.status !== "OPEN") throw new Error("POSITION_ALREADY_CLOSED");
  if (!positiveFinite(input.exitPrice)) throw new Error("INVALID_POSITION_EXIT_PRICE");

  const reason = normalizeExitReason(input.reason);
  const closedAt = normalizeTimestamp(input.closedAt, "INVALID_POSITION_CLOSE_TIME");
  if (Date.parse(closedAt) < Date.parse(position.openedAt)) {
    throw new Error("INVALID_POSITION_CLOSE_TIME");
  }

  if (reason === "STOP_LOSS" && input.exitPrice !== position.stopLossPrice) {
    throw new Error("STOP_LOSS_EXIT_PRICE_MISMATCH");
  }

  if (reason === "TAKE_PROFIT") {
    if (position.takeProfitPrice === undefined) {
      throw new Error("TAKE_PROFIT_NOT_CONFIGURED");
    }
    if (input.exitPrice !== position.takeProfitPrice) {
      throw new Error("TAKE_PROFIT_EXIT_PRICE_MISMATCH");
    }
  }

  const pnlUsd = position.amountUsd * ((input.exitPrice - position.entryPrice) / position.entryPrice);
  const returnPercent = (pnlUsd / position.amountUsd) * 100;

  return {
    ...position,
    status: "CLOSED",
    closedAt,
    exitPrice: input.exitPrice,
    exitReason: reason,
    pnlUsd,
    returnPercent,
  };
}
