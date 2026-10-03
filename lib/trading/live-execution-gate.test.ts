import { describe, expect, it } from "vitest";
import { evaluateLiveExecutionGate } from "@/lib/trading/live-execution-gate";

describe("live execution safety gate", () => {
  const safeInput = {
    liveTradingEnabled: true,
    credentialsConfigured: true,
    ownerApprovalValid: true,
    shariahApproved: true,
    riskApproved: true,
    emergencyStopActive: false,
    amountUsd: 1,
    hasStopLoss: true,
    hasTakeProfit: true,
    exchangeAdapterReady: true,
    withdrawalsDisabled: true,
  } as const;

  it("allows only a fully satisfied execution precondition set", () => {
    expect(evaluateLiveExecutionGate(safeInput)).toEqual({ allowed: true, reasons: [] });
  });

  it("keeps live execution blocked while the live flag is disabled", () => {
    const result = evaluateLiveExecutionGate({
      ...safeInput,
      liveTradingEnabled: false,
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("LIVE_TRADING_DISABLED");
  });

  it("blocks execution when any critical control is missing", () => {
    const result = evaluateLiveExecutionGate({
      ...safeInput,
      ownerApprovalValid: false,
      shariahApproved: false,
      riskApproved: false,
      emergencyStopActive: true,
      hasStopLoss: false,
      hasTakeProfit: false,
      withdrawalsDisabled: false,
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toEqual([
      "OWNER_APPROVAL_REQUIRED",
      "SHARIAH_APPROVAL_REQUIRED",
      "RISK_APPROVAL_REQUIRED",
      "EMERGENCY_STOP_ACTIVE",
      "STOP_LOSS_REQUIRED",
      "TAKE_PROFIT_REQUIRED",
      "WITHDRAWALS_MUST_BE_DISABLED",
    ]);
  });

  it("enforces the one-dollar minimum by default", () => {
    const result = evaluateLiveExecutionGate({
      ...safeInput,
      amountUsd: 0.99,
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("LIVE_ORDER_AMOUNT_BELOW_MINIMUM");
  });

  it("supports a stricter configured minimum", () => {
    const result = evaluateLiveExecutionGate({
      ...safeInput,
      amountUsd: 1,
      minimumAmountUsd: 5,
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("LIVE_ORDER_AMOUNT_BELOW_MINIMUM");
  });
});
