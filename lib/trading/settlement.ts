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
