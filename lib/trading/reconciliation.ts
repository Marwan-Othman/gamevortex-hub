/**
 * GameVortex AI Trading — paper execution reconciliation.
 *
 * Compares the immutable execution record with the resulting paper position.
 * Any mismatch is surfaced explicitly instead of being silently accepted.
 * This function is fail-closed: malformed execution metadata is reported as
 * a reconciliation mismatch rather than being treated as a successful match.
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

function requiredIdentifier(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 200;
}

function positiveFinite(value: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function finiteOrUndefined(value: number | undefined): boolean {
  return value === undefined || positiveFinite(value);
}

export function reconcilePaperExecution(
  execution: PaperExecutionRecord,
  position: PaperPosition,
): PaperReconciliation {
  const reasons: string[] = [];

  if (!requiredIdentifier(execution.clientOrderId)) reasons.push("INVALID_CLIENT_ORDER_ID");
  if (!requiredIdentifier(execution.positionId)) reasons.push("INVALID_EXECUTION_POSITION_ID");
  if (!requiredIdentifier(position.positionId)) reasons.push("INVALID_POSITION_ID");
  if (!positiveFinite(execution.amountUsd)) reasons.push("INVALID_EXECUTION_AMOUNT");
  if (!positiveFinite(position.amountUsd)) reasons.push("INVALID_POSITION_AMOUNT");
  if (!positiveFinite(execution.entryPrice)) reasons.push("INVALID_EXECUTION_ENTRY_PRICE");
  if (!positiveFinite(position.entryPrice)) reasons.push("INVALID_POSITION_ENTRY_PRICE");
  if (!positiveFinite(execution.stopLossPrice)) reasons.push("INVALID_EXECUTION_STOP_LOSS");
  if (!positiveFinite(position.stopLossPrice)) reasons.push("INVALID_POSITION_STOP_LOSS");
  if (!finiteOrUndefined(execution.takeProfitPrice)) reasons.push("INVALID_EXECUTION_TAKE_PROFIT");
  if (!finiteOrUndefined(position.takeProfitPrice)) reasons.push("INVALID_POSITION_TAKE_PROFIT");

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
      reasons: [...new Set(reasons)],
    };
  }

  return {
    status: "MATCHED",
    positionId: position.positionId,
    clientOrderId: execution.clientOrderId,
  };
}
