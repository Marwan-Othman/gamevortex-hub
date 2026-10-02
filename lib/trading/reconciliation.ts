/**
 * GameVortex AI Trading — paper execution reconciliation.
 *
 * Compares the immutable execution record with the resulting paper position.
 * Any mismatch is surfaced explicitly instead of being silently accepted.
 */

import type { PaperExecutionRecord } from "./paper-execution-bridge";
import type { PaperPosition } from "./position";

export type PaperReconciliation =
  | {
      status: "MATCHED";
      positionId: string;
      clientOrderId: string;
    }
  | {
      status: "MISMATCHED";
      positionId: string;
      clientOrderId: string;
      reasons: string[];
    };

export function reconcilePaperExecution(
  execution: PaperExecutionRecord,
  position: PaperPosition,
): PaperReconciliation {
  const reasons: string[] = [];

  if (execution.positionId !== position.positionId) reasons.push("POSITION_ID_MISMATCH");
  if (execution.symbol !== position.symbol) reasons.push("SYMBOL_MISMATCH");
  if (execution.amountUsd !== position.amountUsd) reasons.push("AMOUNT_MISMATCH");
  if (execution.entryPrice !== position.entryPrice) reasons.push("ENTRY_PRICE_MISMATCH");
  if (execution.stopLossPrice !== position.stopLossPrice) reasons.push("STOP_LOSS_MISMATCH");
  if (execution.takeProfitPrice !== position.takeProfitPrice) reasons.push("TAKE_PROFIT_MISMATCH");
  if (execution.shariahPolicyVersion !== position.shariahPolicyVersion) {
    reasons.push("SHARIAH_POLICY_VERSION_MISMATCH");
  }

  if (reasons.length > 0) {
    return {
      status: "MISMATCHED",
      positionId: position.positionId,
      clientOrderId: execution.clientOrderId,
      reasons,
    };
  }

  return {
    status: "MATCHED",
    positionId: position.positionId,
    clientOrderId: execution.clientOrderId,
  };
}
