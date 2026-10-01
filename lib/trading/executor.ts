/**
 * GameVortex AI Trading — guarded execution planner.
 *
 * This module is intentionally NOT a live broker/exchange client.
 * It is the final, side-effect-free contract between owner approval and a
 * future order adapter. PAPER mode returns a normalized execution plan.
 * LIVE mode is fail-closed until a separately reviewed exchange adapter exists.
 *
 * Invariants enforced here:
 * - owner approval must already be consumed;
 * - amount is USD and >= $1;
 * - spot BUY only (no margin, leverage, short selling, or derivatives);
 * - stop-loss is mandatory;
 * - Shariah + risk gates must both allow the trade;
 * - no withdrawal capability is represented by this contract;
 * - idempotency key is required and becomes part of the client order id.
 */

import { createHash } from "node:crypto";
import {
  assertPreTradeAllowed,
  evaluatePreTrade,
  type PreTradeDecision,
} from "@/lib/trading/pre-trade-guard";
import type { RiskConfig, RiskSnapshot } from "@/lib/trading/risk";
import type { ShariahAssetInput, ShariahPolicy } from "@/lib/trading/shariah";

export type TradingExecutionMode = "PAPER" | "LIVE";

export type TradingExecutionRequest = {
  mode: TradingExecutionMode;
  ownerId: string;
  opportunityId: string;
  idempotencyKey: string;
  approvalConsumed: boolean;
  symbol: string;
  amountUsd: number;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice?: number;
  shariah: ShariahAssetInput;
  riskConfig: RiskConfig;
  riskSnapshot: RiskSnapshot;
  shariahPolicy?: ShariahPolicy;
};

export type TradingExecutionPlan = {
  status: "PAPER_READY";
  mode: "PAPER";
  clientOrderId: string;
  ownerId: string;
  opportunityId: string;
  idempotencyKey: string;
  symbol: string;
  side: "BUY";
  orderType: "SPOT_MARKET";
  amountUsd: number;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice?: number;
  leverage: 1;
  margin: false;
  short: false;
  withdrawalPermission: false;
  preTrade: PreTradeDecision;
};

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function normalizeSymbol(symbol: string): string {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized || !/^[A-Z0-9._:-]{1,32}$/.test(normalized)) {
    throw new Error("INVALID_EXECUTION_SYMBOL");
  }
  return normalized;
}

function normalizeId(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 200) throw new Error(code);
  return normalized;
}

function buildClientOrderId(idempotencyKey: string): string {
  return `gv-paper-${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 32)}`;
}

function validateExecutionShape(input: TradingExecutionRequest): void {
  normalizeId(input.ownerId, "INVALID_EXECUTION_OWNER");
  normalizeId(input.opportunityId, "INVALID_EXECUTION_OPPORTUNITY");
  normalizeId(input.idempotencyKey, "INVALID_EXECUTION_IDEMPOTENCY_KEY");
  normalizeSymbol(input.symbol);

  if (!input.approvalConsumed) throw new Error("OWNER_APPROVAL_REQUIRED");
  if (!positiveFinite(input.amountUsd) || input.amountUsd < 1) {
    throw new Error("INVALID_TRADE_AMOUNT");
  }
  if (!positiveFinite(input.entryPrice) || !positiveFinite(input.stopLossPrice)) {
    throw new Error("INVALID_EXECUTION_PRICES");
  }
  if (input.stopLossPrice >= input.entryPrice) {
    throw new Error("INVALID_STOP_LOSS_FOR_BUY");
  }
  if (input.takeProfitPrice !== undefined) {
    if (!positiveFinite(input.takeProfitPrice) || input.takeProfitPrice <= input.entryPrice) {
      throw new Error("INVALID_TAKE_PROFIT_FOR_BUY");
    }
  }
}

/**
 * Build the only execution plan currently permitted by GameVortex.
 * No network call, wallet mutation, or exchange credential access occurs here.
 */
export function buildTradingExecutionPlan(
  input: TradingExecutionRequest,
): TradingExecutionPlan {
  validateExecutionShape(input);

  const preTrade = evaluatePreTrade({
    shariah: input.shariah,
    riskConfig: input.riskConfig,
    riskSnapshot: input.riskSnapshot,
    shariahPolicy: input.shariahPolicy,
  });
  assertPreTradeAllowed(preTrade);

  if (input.mode !== "PAPER") {
    throw new Error("LIVE_EXECUTION_DISABLED");
  }

  return {
    status: "PAPER_READY",
    mode: "PAPER",
    clientOrderId: buildClientOrderId(input.idempotencyKey),
    ownerId: input.ownerId.trim(),
    opportunityId: input.opportunityId.trim(),
    idempotencyKey: input.idempotencyKey.trim(),
    symbol: normalizeSymbol(input.symbol),
    side: "BUY",
    orderType: "SPOT_MARKET",
    amountUsd: input.amountUsd,
    entryPrice: input.entryPrice,
    stopLossPrice: input.stopLossPrice,
    takeProfitPrice: input.takeProfitPrice,
    leverage: 1,
    margin: false,
    short: false,
    withdrawalPermission: false,
    preTrade,
  };
}
