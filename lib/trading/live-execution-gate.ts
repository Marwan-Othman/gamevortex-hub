/**
 * GameVortex AI Trading — final pre-execution safety gate.
 *
 * This module is deliberately side-effect free. It never contacts an exchange,
 * moves money, changes database state, or enables live trading. It provides a
 * single deterministic decision that a future executor must satisfy before it
 * is allowed to submit a production order.
 */

export type LiveExecutionGateInput = {
  liveTradingEnabled: boolean;
  credentialsConfigured: boolean;
  ownerApprovalValid: boolean;
  shariahApproved: boolean;
  riskApproved: boolean;
  emergencyStopActive: boolean;
  amountUsd: number;
  minimumAmountUsd?: number;
  hasStopLoss: boolean;
  hasTakeProfit: boolean;
  exchangeAdapterReady: boolean;
  withdrawalsDisabled: boolean;
};

export type LiveExecutionGateResult =
  | { allowed: true; reasons: [] }
  | { allowed: false; reasons: string[] };

export function evaluateLiveExecutionGate(
  input: LiveExecutionGateInput,
): LiveExecutionGateResult {
  const minimumAmountUsd = input.minimumAmountUsd ?? 1;
  const reasons: string[] = [];

  if (!input.liveTradingEnabled) reasons.push("LIVE_TRADING_DISABLED");
  if (!input.credentialsConfigured) reasons.push("LIVE_CREDENTIALS_NOT_CONFIGURED");
  if (!input.ownerApprovalValid) reasons.push("OWNER_APPROVAL_REQUIRED");
  if (!input.shariahApproved) reasons.push("SHARIAH_APPROVAL_REQUIRED");
  if (!input.riskApproved) reasons.push("RISK_APPROVAL_REQUIRED");
  if (input.emergencyStopActive) reasons.push("EMERGENCY_STOP_ACTIVE");
  if (!Number.isFinite(input.amountUsd) || input.amountUsd < minimumAmountUsd) {
    reasons.push("LIVE_ORDER_AMOUNT_BELOW_MINIMUM");
  }
  if (!input.hasStopLoss) reasons.push("STOP_LOSS_REQUIRED");
  if (!input.hasTakeProfit) reasons.push("TAKE_PROFIT_REQUIRED");
  if (!input.exchangeAdapterReady) reasons.push("LIVE_EXCHANGE_ADAPTER_NOT_READY");
  if (!input.withdrawalsDisabled) reasons.push("WITHDRAWALS_MUST_BE_DISABLED");

  if (reasons.length > 0) {
    return { allowed: false, reasons };
  }

  return { allowed: true, reasons: [] };
}
