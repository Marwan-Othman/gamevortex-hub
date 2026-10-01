/**
 * GameVortex AI Trading — Pre-Trade Guard.
 *
 * This is the final policy gate before a future Trading Executor can create an
 * order. It intentionally has no side effects and no network access.
 *
 * The executor must call this guard immediately before order submission. A
 * caller must satisfy BOTH Shariah and risk policy. REVIEW is not approval.
 */

import {
  assertRiskAllowed,
  evaluateRisk,
  type RiskConfig,
  type RiskSnapshot,
} from "@/lib/trading/risk";
import {
  assertShariahApproved,
  evaluateShariah,
  type ShariahAssetInput,
  type ShariahDecision,
  type ShariahPolicy,
} from "@/lib/trading/shariah";

export type PreTradeInput = {
  shariah: ShariahAssetInput;
  riskConfig: RiskConfig;
  riskSnapshot: RiskSnapshot;
  shariahPolicy?: ShariahPolicy;
};

export type PreTradeDecision = {
  allowed: boolean;
  shariah: ShariahDecision;
  risk: ReturnType<typeof evaluateRisk>;
  reasons: string[];
};

export function evaluatePreTrade(input: PreTradeInput): PreTradeDecision {
  const shariah = evaluateShariah(input.shariah, input.shariahPolicy);
  const risk = evaluateRisk(input.riskConfig, input.riskSnapshot);
  const reasons: string[] = [];

  if (shariah.status !== "APPROVED") {
    reasons.push(`SHARIAH_${shariah.status}`);
  }

  if (!risk.allowed) {
    reasons.push(...risk.reasons);
  }

  return {
    allowed: reasons.length === 0,
    shariah,
    risk,
    reasons,
  };
}

export function assertPreTradeAllowed(decision: PreTradeDecision): void {
  assertShariahApproved(decision.shariah);
  assertRiskAllowed(decision.risk);
}
