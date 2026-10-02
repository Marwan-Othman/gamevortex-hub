/**
 * GameVortex AI Trading — guarded owner paper-trading opportunity pipeline.
 *
 * This module composes existing deterministic guards. It has no network access,
 * does not mutate wallets, and cannot create a LIVE execution plan.
 *
 * Pipeline:
 * market data -> strategy -> proposal validation -> Shariah/Risk guards
 * -> owner approval contract -> PAPER execution plan.
 */

import {
  buildTradingExecutionPlan,
  type TradingExecutionPlan,
} from "@/lib/trading/executor";
import {
  evaluatePreTrade,
  type PreTradeDecision,
} from "@/lib/trading/pre-trade-guard";
import { evaluateStrategy, type StrategyDecision } from "@/lib/trading/strategy";
import type { RiskConfig, RiskSnapshot } from "@/lib/trading/risk";
import type { ShariahAssetInput, ShariahPolicy } from "@/lib/trading/shariah";

export type TradeOpportunityInput = {
  ownerId: string;
  opportunityId: string;
  idempotencyKey: string;
  symbol: string;
  amountUsd: number;
  strategy: {
    price: number;
    previousPrice: number;
    fastAverage: number;
    slowAverage: number;
    volume: number;
    averageVolume: number;
    stopLossPercent: number;
    takeProfitPercent: number;
  };
  shariah: ShariahAssetInput;
  riskConfig: RiskConfig;
  riskSnapshot: RiskSnapshot;
  shariahPolicy?: ShariahPolicy;
  approval: {
    id: string;
    ownerId: string;
    opportunityId: string;
    status: "PENDING" | "CONSUMED" | "REVOKED" | "EXPIRED";
    amountUsd: number;
    consumedAt?: string | null;
  };
};

export type TradeProposal = {
  ownerId: string;
  opportunityId: string;
  idempotencyKey: string;
  symbol: string;
  side: "BUY";
  amountUsd: number;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice?: number;
  strategy: StrategyDecision;
  preTrade: PreTradeDecision;
  approvalId: string;
  approvalStatus: TradeOpportunityInput["approval"]["status"];
  approvalAmountUsd: number;
};

export type TradeOpportunityResult = {
  proposal: TradeProposal;
  executionPlan?: TradingExecutionPlan;
};

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function normalizedId(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 200) throw new Error(code);
  return normalized;
}

function sameUsdAmount(left: number, right: number): boolean {
  return Number.isFinite(left) && Number.isFinite(right) && Math.round(left * 100) === Math.round(right * 100);
}

function assertApprovalContract(input: TradeOpportunityInput): void {
  const ownerId = normalizedId(input.ownerId, "INVALID_OPPORTUNITY_OWNER");
  const opportunityId = normalizedId(input.opportunityId, "INVALID_OPPORTUNITY_ID");
  const approvalOwnerId = normalizedId(input.approval.ownerId, "INVALID_APPROVAL_OWNER");
  const approvalOpportunityId = normalizedId(input.approval.opportunityId, "INVALID_APPROVAL_OPPORTUNITY");
  normalizedId(input.approval.id, "INVALID_APPROVAL_ID");

  if (approvalOwnerId !== ownerId) {
    throw new Error("APPROVAL_OWNER_MISMATCH");
  }
  if (approvalOpportunityId !== opportunityId) {
    throw new Error("APPROVAL_OPPORTUNITY_MISMATCH");
  }
  if (input.approval.status !== "CONSUMED") {
    throw new Error("OWNER_APPROVAL_NOT_CONSUMED");
  }

  if (!positiveFinite(input.amountUsd)) {
    throw new Error("INVALID_TRADE_AMOUNT");
  }
  if (!positiveFinite(input.approval.amountUsd)) {
    throw new Error("INVALID_APPROVAL_AMOUNT");
  }
  if (!sameUsdAmount(input.approval.amountUsd, input.amountUsd)) {
    throw new Error("APPROVAL_AMOUNT_MISMATCH");
  }

  if (!input.approval.consumedAt || !Number.isFinite(Date.parse(input.approval.consumedAt))) {
    throw new Error("APPROVAL_CONSUMED_AT_REQUIRED");
  }
}

function assertProposalShape(
  input: TradeOpportunityInput,
  strategy: StrategyDecision,
): void {
  const ownerId = normalizedId(input.ownerId, "INVALID_OPPORTUNITY_OWNER");
  const opportunityId = normalizedId(input.opportunityId, "INVALID_OPPORTUNITY_ID");
  normalizedId(input.idempotencyKey, "INVALID_OPPORTUNITY_IDEMPOTENCY_KEY");
  const approvalOwnerId = normalizedId(input.approval.ownerId, "INVALID_APPROVAL_OWNER");
  const approvalOpportunityId = normalizedId(input.approval.opportunityId, "INVALID_APPROVAL_OPPORTUNITY");
  normalizedId(input.approval.id, "INVALID_APPROVAL_ID");

  // Proposal creation may happen before approval is consumed, but the proposal
  // must never be bound to a different owner/opportunity or a tampered amount.
  if (approvalOwnerId !== ownerId) {
    throw new Error("APPROVAL_OWNER_MISMATCH");
  }
  if (approvalOpportunityId !== opportunityId) {
    throw new Error("APPROVAL_OPPORTUNITY_MISMATCH");
  }
  if (!positiveFinite(input.amountUsd)) {
    throw new Error("INVALID_TRADE_AMOUNT");
  }
  if (!positiveFinite(input.approval.amountUsd)) {
    throw new Error("INVALID_APPROVAL_AMOUNT");
  }
  if (!sameUsdAmount(input.approval.amountUsd, input.amountUsd)) {
    throw new Error("APPROVAL_AMOUNT_MISMATCH");
  }

  if (strategy.side !== "BUY") throw new Error("NO_BUY_SIGNAL");
  if (!strategy.stopLossPrice || strategy.stopLossPrice >= strategy.entryPrice) {
    throw new Error("STOP_LOSS_REQUIRED");
  }
  if (
    strategy.takeProfitPrice !== undefined &&
    strategy.takeProfitPrice <= strategy.entryPrice
  ) {
    throw new Error("INVALID_TAKE_PROFIT_FOR_BUY");
  }
}

export function buildTradeProposal(input: TradeOpportunityInput): TradeProposal {
  const strategy = evaluateStrategy({
    symbol: input.symbol,
    price: input.strategy.price,
    previousPrice: input.strategy.previousPrice,
    fastAverage: input.strategy.fastAverage,
    slowAverage: input.strategy.slowAverage,
    volume: input.strategy.volume,
    averageVolume: input.strategy.averageVolume,
    stopLossPercent: input.strategy.stopLossPercent,
    takeProfitPercent: input.strategy.takeProfitPercent,
  });

  assertProposalShape(input, strategy);

  const preTrade = evaluatePreTrade({
    shariah: input.shariah,
    riskConfig: input.riskConfig,
    riskSnapshot: input.riskSnapshot,
    shariahPolicy: input.shariahPolicy,
  });

  if (!preTrade.allowed) {
    throw new Error(`PRE_TRADE_BLOCKED:${preTrade.reasons.join(",")}`);
  }

  return {
    ownerId: input.ownerId.trim(),
    opportunityId: input.opportunityId.trim(),
    idempotencyKey: input.idempotencyKey.trim(),
    symbol: strategy.symbol,
    side: "BUY",
    amountUsd: input.amountUsd,
    entryPrice: strategy.entryPrice,
    stopLossPrice: strategy.stopLossPrice!,
    takeProfitPrice: strategy.takeProfitPrice,
    strategy,
    preTrade,
    approvalId: input.approval.id.trim(),
    approvalStatus: input.approval.status,
    approvalAmountUsd: input.approval.amountUsd,
  };
}

export function buildApprovedPaperExecution(
  input: TradeOpportunityInput,
  proposal: TradeProposal,
): TradingExecutionPlan {
  assertApprovalContract(input);

  if (proposal.ownerId !== input.ownerId.trim()) {
    throw new Error("PROPOSAL_OWNER_MISMATCH");
  }
  if (proposal.opportunityId !== input.opportunityId.trim()) {
    throw new Error("PROPOSAL_OPPORTUNITY_MISMATCH");
  }
  if (proposal.approvalId !== input.approval.id.trim()) {
    throw new Error("APPROVAL_ID_MISMATCH");
  }
  if (proposal.approvalStatus !== "CONSUMED") {
    throw new Error("OWNER_APPROVAL_NOT_CONSUMED");
  }
  if (!sameUsdAmount(proposal.approvalAmountUsd, input.approval.amountUsd)) {
    throw new Error("APPROVAL_AMOUNT_MISMATCH");
  }
  if (!sameUsdAmount(proposal.amountUsd, input.amountUsd)) {
    throw new Error("PROPOSAL_AMOUNT_MISMATCH");
  }

  return buildTradingExecutionPlan({
    mode: "PAPER",
    ownerId: proposal.ownerId,
    opportunityId: proposal.opportunityId,
    idempotencyKey: proposal.idempotencyKey,
    approvalConsumed: true,
    symbol: proposal.symbol,
    amountUsd: proposal.amountUsd,
    entryPrice: proposal.entryPrice,
    stopLossPrice: proposal.stopLossPrice,
    takeProfitPrice: proposal.takeProfitPrice,
    shariah: input.shariah,
    riskConfig: input.riskConfig,
    riskSnapshot: input.riskSnapshot,
    shariahPolicy: input.shariahPolicy,
  });
}

export function buildOwnerPaperOpportunity(
  input: TradeOpportunityInput,
): TradeOpportunityResult {
  const proposal = buildTradeProposal(input);
  const executionPlan = buildApprovedPaperExecution(input, proposal);
  return { proposal, executionPlan };
}
