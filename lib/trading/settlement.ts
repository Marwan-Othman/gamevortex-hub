/**
 * GameVortex AI Trading — deterministic paper settlement.
 *
 * Settlement is intentionally accounting-only for PAPER mode. It computes the
 * value returned to the simulated trading balance from a closed position.
 * No real-money transfer, wallet mutation, exchange call, or payout occurs.
 */

import type { PaperPosition } from "./position";

export type PaperSettlement = {
  status: "SETTLED";
  positionId: string;
  symbol: string;
  amountUsd: number;
  entryPrice: number;
  exitPrice: number;
  pnlUsd: number;
  returnPercent: number;
  settlementValueUsd: number;
  shariahPolicyVersion: string;
};

function finiteNumber(value: number): boolean {
  return Number.isFinite(value);
}

function approximatelyEqual(a: number, b: number): boolean {
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= Number.EPSILON * scale * 16;
}

export function settleClosedPaperPosition(position: PaperPosition): PaperSettlement {
  if (position.status !== "CLOSED") {
    throw new Error("PAPER_POSITION_MUST_BE_CLOSED");
  }

  if (
    position.exitPrice === undefined ||
    position.pnlUsd === undefined ||
    position.returnPercent === undefined
  ) {
    throw new Error("INCOMPLETE_PAPER_POSITION_SETTLEMENT");
  }

  if (
    !finiteNumber(position.amountUsd) ||
    !finiteNumber(position.entryPrice) ||
    !finiteNumber(position.exitPrice) ||
    !finiteNumber(position.pnlUsd) ||
    !finiteNumber(position.returnPercent)
  ) {
    throw new Error("INVALID_PAPER_SETTLEMENT_NUMBERS");
  }

  if (position.amountUsd <= 0 || position.entryPrice <= 0 || position.exitPrice <= 0) {
    throw new Error("INVALID_PAPER_SETTLEMENT_PRICES");
  }

  const expectedPnlUsd =
    position.amountUsd * ((position.exitPrice - position.entryPrice) / position.entryPrice);
  const expectedReturnPercent = (expectedPnlUsd / position.amountUsd) * 100;

  if (!approximatelyEqual(position.pnlUsd, expectedPnlUsd)) {
    throw new Error("PAPER_SETTLEMENT_PNL_DRIFT");
  }

  if (!approximatelyEqual(position.returnPercent, expectedReturnPercent)) {
    throw new Error("PAPER_SETTLEMENT_RETURN_DRIFT");
  }

  const settlementValueUsd = position.amountUsd + position.pnlUsd;
  if (!finiteNumber(settlementValueUsd) || settlementValueUsd <= 0) {
    throw new Error("INVALID_PAPER_SETTLEMENT_VALUE");
  }

  return {
    status: "SETTLED",
    positionId: position.positionId,
    symbol: position.symbol,
    amountUsd: position.amountUsd,
    entryPrice: position.entryPrice,
    exitPrice: position.exitPrice,
    pnlUsd: position.pnlUsd,
    returnPercent: position.returnPercent,
    settlementValueUsd,
    shariahPolicyVersion: position.shariahPolicyVersion,
  };
}
