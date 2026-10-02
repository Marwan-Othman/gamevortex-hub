/**
 * GameVortex AI Trading — paper execution to position bridge.
 *
 * This module connects the guarded PAPER execution plan to the existing
 * side-effect-free position lifecycle. It does not touch wallets, databases,
 * exchanges, credentials, or live execution.
 */

import { openPaperPosition, type PaperPosition } from "./position";
import type { TradingExecutionPlan } from "./executor";

export type PaperExecutionRecord = {
  clientOrderId: string;
  positionId: string;
  symbol: string;
  amountUsd: number;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice?: number;
  shariahPolicyVersion: string;
};

export type OpenPaperExecution = {
  execution: PaperExecutionRecord;
  position: PaperPosition;
};

export function openPaperPositionFromExecutionPlan(input: {
  plan: TradingExecutionPlan;
  positionId: string;
  openedAt: string;
  shariahPolicyVersion: string;
}): OpenPaperExecution {
  if (input.plan.status !== "PAPER_READY" || input.plan.mode !== "PAPER") {
    throw new Error("PAPER_EXECUTION_PLAN_REQUIRED");
  }

  const position = openPaperPosition({
    positionId: input.positionId,
    symbol: input.plan.symbol,
    amountUsd: input.plan.amountUsd,
    entryPrice: input.plan.entryPrice,
    stopLossPrice: input.plan.stopLossPrice,
    takeProfitPrice: input.plan.takeProfitPrice,
    openedAt: input.openedAt,
    shariahPolicyVersion: input.shariahPolicyVersion,
  });

  return {
    execution: {
      clientOrderId: input.plan.clientOrderId,
      positionId: position.positionId,
      symbol: position.symbol,
      amountUsd: position.amountUsd,
      entryPrice: position.entryPrice,
      stopLossPrice: position.stopLossPrice,
      takeProfitPrice: position.takeProfitPrice,
      shariahPolicyVersion: position.shariahPolicyVersion,
    },
    position,
  };
}
