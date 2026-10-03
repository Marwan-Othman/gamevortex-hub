/**
 * Safe production-readiness contract. It never calls a live exchange or mutates balances.
 */
import { assertLiveAdapterCapability, type ExchangeAdapter } from "@/lib/trading/exchange-adapter";
import { evaluateLiveExecutionGate } from "@/lib/trading/live-execution-gate";
import { buildProtectedExitPlan, type ProtectedExitPlan } from "@/lib/trading/protected-exit-plan";

export type LiveExecutionReadinessInput = {
  liveTradingEnabled: boolean;
  credentialsConfigured: boolean;
  ownerApprovalValid: boolean;
  shariahApproved: boolean;
  riskApproved: boolean;
  emergencyStopActive: boolean;
  withdrawalsDisabled: boolean;
  amountUsd: number;
  symbol: string;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  stopLimitPrice: number;
  filledQuantity: number;
  clientOrderId: string;
};

export type LiveExecutionReadinessResult = {
  ready: boolean;
  reasons: string[];
  sequence: readonly ["INTENT_CREATED", "SUBMITTING", "PROVIDER_RECONCILIATION", "FILLED", "PROTECTION_PENDING", "PROTECTED"];
  protectedExit: ProtectedExitPlan | null;
};

export function evaluateLiveExecutionReadiness(
  input: LiveExecutionReadinessInput,
  adapter: ExchangeAdapter,
): LiveExecutionReadinessResult {
  const reasons: string[] = [];
  try {
    assertLiveAdapterCapability(adapter);
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : "LIVE_ADAPTER_CONTRACT_INVALID");
  }

  const gate = evaluateLiveExecutionGate({
    liveTradingEnabled: input.liveTradingEnabled,
    credentialsConfigured: input.credentialsConfigured,
    ownerApprovalValid: input.ownerApprovalValid,
    shariahApproved: input.shariahApproved,
    riskApproved: input.riskApproved,
    emergencyStopActive: input.emergencyStopActive,
    amountUsd: input.amountUsd,
    minimumAmountUsd: 1,
    hasStopLoss: true,
    hasTakeProfit: true,
    exchangeAdapterReady: reasons.length === 0,
    withdrawalsDisabled: input.withdrawalsDisabled,
  });
  reasons.push(...gate.reasons);

  let protectedExit: ProtectedExitPlan | null = null;
  if (gate.allowed && reasons.length === 0) {
    try {
      protectedExit = buildProtectedExitPlan({
        symbol: input.symbol,
        entryClientOrderId: input.clientOrderId,
        filledQuantity: input.filledQuantity,
        entryPrice: input.entryPrice,
        takeProfitPrice: input.takeProfitPrice,
        stopLossPrice: input.stopLossPrice,
        stopLimitPrice: input.stopLimitPrice,
      });
    } catch (error) {
      reasons.push(error instanceof Error ? error.message : "PROTECTED_EXIT_PLAN_INVALID");
    }
  }

  return {
    ready: reasons.length === 0 && protectedExit !== null,
    reasons: [...new Set(reasons)],
    sequence: ["INTENT_CREATED", "SUBMITTING", "PROVIDER_RECONCILIATION", "FILLED", "PROTECTION_PENDING", "PROTECTED"],
    protectedExit,
  };
}
