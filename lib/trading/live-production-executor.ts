/**
 * GameVortex AI Trading — controlled production execution coordinator.
 *
 * This module is server-only and remains fail-closed while the live flag is
 * false, the trading control is stopped, the Shariah policy is not reviewed,
 * or Binance production preflight is not clean.
 *
 * The coordinator does not directly settle GameVortex wallet funds. A fully
 * closed exchange position is recorded as EXCHANGE_CLOSED_PENDING_WALLET
 * until the separate allocation-backed wallet settlement stage is complete.
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/prisma";
import { getBinanceLivePreflight } from "@/lib/trading/binance-live-preflight";
import { assertBinanceLiveBuyRules, assertBinanceLiveProtectedExitRules } from "@/lib/trading/binance-live-symbol-rules";
import { BinanceSpotLiveAdapter } from "@/lib/trading/binance-spot-live-adapter";
import { getTradingControl, tripCircuitBreaker } from "@/lib/trading/control-service";
import { controlBlockReasons } from "@/lib/trading/control";
import { getRiskConfig } from "@/lib/trading/risk-config-service";
import { evaluateRisk, type RiskSnapshot } from "@/lib/trading/risk";
import { checkAndRecordShariah } from "@/lib/trading/shariah-service";
import type { ShariahAssetInput } from "@/lib/trading/shariah";
import { getConsumedOwnerApproval } from "@/lib/trading/opportunity-service";
import {
  createLiveOrderIntent,
  getLiveOrderByIdempotencyKey,
  markLiveOrderProtectionFailed,
  markLiveOrderProtected,
  markLiveOrderUnknown,
  reconcileStoredLiveOrder,
  transitionLiveOrderState,
  type LiveOrderRow,
} from "@/lib/trading/live-order-state";
import { buildProtectedExitPlan } from "@/lib/trading/protected-exit-plan";
import { reconcileProtectedExitSettlement } from "@/lib/trading/live-exit-settlement";

const LIVE_IDEMPOTENCY_PREFIX = "live-approval:";
const STOP_LIMIT_BUFFER = 0.001;

type ExecutionSnapshot = {
  symbol: string;
  price: number;
  previousPrice: number;
  fastAverage: number;
  slowAverage: number;
  volume: number;
  averageVolume: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  shariah: ShariahAssetInput;
};

export type LiveExecutionResult = {
  realMoney: true;
  status: LiveOrderRow["status"];
  orderId: string;
  clientOrderId: string;
  providerOrderId: string | null;
  symbol: string;
  amountUsd: string;
  protectionStatus: LiveOrderRow["protectionStatus"];
  settlementStatus: "NOT_SETTLED" | "EXCHANGE_CLOSED_PENDING_WALLET" | "BLOCKED";
  blockers: string[];
};

function asObject(value: Prisma.JsonValue | null, code: string): Prisma.JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as Prisma.JsonObject;
}

function positiveNumber(value: unknown, code: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(code);
  return value;
}

function parseExecutionSnapshot(value: Prisma.JsonValue | null): ExecutionSnapshot {
  const snapshot = asObject(value, "APPROVAL_EXECUTION_SNAPSHOT_REQUIRED");
  const shariah = snapshot.shariah;
  if (!shariah || typeof shariah !== "object" || Array.isArray(shariah)) {
    throw new Error("APPROVAL_SHARIAH_SNAPSHOT_REQUIRED");
  }

  const parsed = {
    symbol: String(snapshot.symbol ?? "").trim().toUpperCase(),
    price: positiveNumber(snapshot.price, "INVALID_APPROVAL_EXECUTION_SNAPSHOT"),
    previousPrice: positiveNumber(snapshot.previousPrice, "INVALID_APPROVAL_EXECUTION_SNAPSHOT"),
    fastAverage: positiveNumber(snapshot.fastAverage, "INVALID_APPROVAL_EXECUTION_SNAPSHOT"),
    slowAverage: positiveNumber(snapshot.slowAverage, "INVALID_APPROVAL_EXECUTION_SNAPSHOT"),
    volume: positiveNumber(snapshot.volume, "INVALID_APPROVAL_EXECUTION_SNAPSHOT"),
    averageVolume: positiveNumber(snapshot.averageVolume, "INVALID_APPROVAL_EXECUTION_SNAPSHOT"),
    stopLossPercent: positiveNumber(snapshot.stopLossPercent, "INVALID_APPROVAL_EXECUTION_SNAPSHOT"),
    takeProfitPercent: positiveNumber(snapshot.takeProfitPercent, "INVALID_APPROVAL_EXECUTION_SNAPSHOT"),
    shariah: shariah as unknown as ShariahAssetInput,
  };

  if (!parsed.symbol || parsed.stopLossPercent >= 100) {
    throw new Error("INVALID_APPROVAL_EXECUTION_SNAPSHOT");
  }

  return parsed;
}

function parseRiskSnapshot(value: Prisma.JsonValue | null, amountUsd: number): RiskSnapshot {
  const snapshot = asObject(value, "APPROVAL_RISK_SNAPSHOT_REQUIRED");
  const numeric = [
    "requestedAmountUsd",
    "dailyLossUsd",
    "openTrades",
    "totalExposureUsd",
    "assetExposureUsd",
    "consecutiveLosses",
  ] as const;

  for (const key of numeric) positiveOrZero(snapshot[key], "INVALID_APPROVAL_RISK_SNAPSHOT");

  if (snapshot.requestedAmountUsd !== amountUsd) throw new Error("APPROVAL_AMOUNT_MISMATCH");
  if (snapshot.hasStopLoss !== true) throw new Error("STOP_LOSS_REQUIRED");
  if (snapshot.hasTakeProfit !== true) throw new Error("TAKE_PROFIT_REQUIRED");

  return {
    requestedAmountUsd: snapshot.requestedAmountUsd as number,
    dailyLossUsd: snapshot.dailyLossUsd as number,
    openTrades: snapshot.openTrades as number,
    totalExposureUsd: snapshot.totalExposureUsd as number,
    assetExposureUsd: snapshot.assetExposureUsd as number,
    consecutiveLosses: snapshot.consecutiveLosses as number,
    hasStopLoss: true,
    hasTakeProfit: true,
    circuitBreakerReasons: Array.isArray(snapshot.circuitBreakerReasons)
      ? snapshot.circuitBreakerReasons.filter((value): value is string => typeof value === "string")
      : undefined,
  };
}

function positiveOrZero(value: unknown, code: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(code);
  return value;
}

function buildProtectedPrices(fillPrice: number, snapshot: ExecutionSnapshot) {
  const stopLossPrice = fillPrice * (1 - snapshot.stopLossPercent / 100);
  const takeProfitPrice = fillPrice * (1 + snapshot.takeProfitPercent / 100);
  const stopLimitPrice = stopLossPrice * (1 - STOP_LIMIT_BUFFER);

  if (
    !Number.isFinite(stopLossPrice) ||
    !Number.isFinite(takeProfitPrice) ||
    !Number.isFinite(stopLimitPrice) ||
    stopLossPrice <= 0 ||
    stopLimitPrice <= 0 ||
    takeProfitPrice <= fillPrice
  ) {
    throw new Error("PROTECTED_EXIT_PRICE_CALCULATION_FAILED");
  }

  return {
    stopLossPrice: stopLossPrice.toFixed(12),
    takeProfitPrice: takeProfitPrice.toFixed(12),
    stopLimitPrice: stopLimitPrice.toFixed(12),
  };
}

function result(
  order: LiveOrderRow,
  settlementStatus: LiveExecutionResult["settlementStatus"] = "NOT_SETTLED",
  blockers: string[] = [],
): LiveExecutionResult {
  return {
    realMoney: true,
    status: order.status,
    orderId: order.id,
    clientOrderId: order.clientOrderId,
    providerOrderId: order.providerOrderId,
    symbol: order.symbol,
    amountUsd: order.amountUsd.toString(),
    protectionStatus: order.protectionStatus,
    settlementStatus,
    blockers,
  };
}

async function audit(ownerId: string, action: string, order: LiveOrderRow, metadata: Prisma.InputJsonValue = {}) {
  await db.auditLog.create({
    data: {
      actorUserId: ownerId,
      action,
      entityType: "TradingLiveOrder",
      entityId: order.id,
      metadata,
    },
  });
}

async function failUnknown(ownerId: string, order: LiveOrderRow, error: unknown): Promise<never> {
  const reason = error instanceof Error ? error.message.slice(0, 300) : "LIVE_EXECUTION_UNKNOWN_FAILURE";
  const updated = await markLiveOrderUnknown(order.id, reason).catch(() => order);
  await tripCircuitBreaker({ ownerId, reason: "ORDER_FAILURE", detail: reason }).catch(() => undefined);
  await audit(ownerId, "TRADING_LIVE_ORDER_UNKNOWN", updated, { reason });
  throw new Error(`LIVE_ORDER_UNKNOWN:${reason}`);
}

async function reconcileExitIfNeeded(
  ownerId: string,
  order: LiveOrderRow,
  adapter: BinanceSpotLiveAdapter,
): Promise<{ order: LiveOrderRow; settlementStatus: LiveExecutionResult["settlementStatus"]; blockers: string[] }> {
  if (order.status !== "PROTECTED" && order.status !== "CLOSED") {
    return { order, settlementStatus: "NOT_SETTLED", blockers: [] };
  }

  const settlement = await reconcileProtectedExitSettlement({ order, adapter });
  if (settlement.status === "BLOCKED") {
    await tripCircuitBreaker({
      ownerId,
      reason: "ORDER_FAILURE",
      detail: settlement.blockers.join(","),
    }).catch(() => undefined);
    await audit(ownerId, "TRADING_LIVE_EXIT_RECONCILIATION_BLOCKED", settlement.order, {
      blockers: settlement.blockers,
    });
    return { order: settlement.order, settlementStatus: "BLOCKED", blockers: settlement.blockers };
  }

  if (settlement.status === "EXCHANGE_CLOSED_PENDING_WALLET") {
    await audit(ownerId, "TRADING_LIVE_EXCHANGE_CLOSED", settlement.order, {
      exitPrice: settlement.exitPrice,
      realizedPnlUsd: settlement.realizedPnlUsd,
      settlementStatus: settlement.status,
    });
    return {
      order: settlement.order,
      settlementStatus: "EXCHANGE_CLOSED_PENDING_WALLET",
      blockers: [],
    };
  }

  return { order: settlement.order, settlementStatus: "NOT_SETTLED", blockers: [] };
}

async function protectFilledOrder(
  ownerId: string,
  order: LiveOrderRow,
  snapshot: ExecutionSnapshot,
  adapter: BinanceSpotLiveAdapter,
): Promise<LiveOrderRow> {
  if (order.status === "PROTECTED" && order.protectionStatus === "PROTECTED") return order;
  if (order.status !== "PROTECTION_PENDING") throw new Error("LIVE_ORDER_NOT_READY_FOR_PROTECTION");

  const fillPrice = order.averageFillPrice?.toNumber() ?? order.entryPrice.toNumber();
  const quantity = order.executedQty?.toString();
  if (!quantity || Number(quantity) <= 0) throw new Error("LIVE_FILLED_QUANTITY_REQUIRED");

  const prices = buildProtectedPrices(fillPrice, snapshot);
  await assertBinanceLiveProtectedExitRules({
    symbol: order.symbol,
    quantity: Number(quantity),
    takeProfitPrice: Number(prices.takeProfitPrice),
    stopLossPrice: Number(prices.stopLossPrice),
    stopLimitPrice: Number(prices.stopLimitPrice),
  });

  const plan = buildProtectedExitPlan({
    symbol: order.symbol,
    entryClientOrderId: order.clientOrderId,
    filledQuantity: quantity,
    entryPrice: fillPrice,
    takeProfitPrice: prices.takeProfitPrice,
    stopLossPrice: prices.stopLossPrice,
    stopLimitPrice: prices.stopLimitPrice,
  });

  try {
    const protection = await adapter.placeProtectedExitOco!({
      symbol: plan.symbol,
      quantity: plan.quantity,
      entryPrice: String(fillPrice),
      takeProfitClientOrderId: plan.takeProfit.clientOrderId,
      takeProfitPrice: plan.takeProfit.price,
      stopLossClientOrderId: plan.stopLoss.clientOrderId,
      stopLossPrice: plan.stopLoss.stopPrice,
      stopLimitPrice: plan.stopLoss.price,
    });

    if (!protection.accepted || protection.orders.length !== 2) {
      throw new Error("LIVE_PROTECTED_EXIT_NOT_CONFIRMED");
    }

    const ids = new Set(protection.orders.map((item) => item.clientOrderId));
    if (!ids.has(plan.takeProfit.clientOrderId) || !ids.has(plan.stopLoss.clientOrderId)) {
      throw new Error("LIVE_PROTECTED_EXIT_CLIENT_IDS_MISMATCH");
    }

    const updated = await markLiveOrderProtected(order.id, {
      protectionOrderId: protection.orderListId,
      stopLossOrderId:
        protection.orders.find((item) => item.clientOrderId === plan.stopLoss.clientOrderId)?.providerOrderId,
      takeProfitOrderId:
        protection.orders.find((item) => item.clientOrderId === plan.takeProfit.clientOrderId)?.providerOrderId,
    });

    await audit(ownerId, "TRADING_LIVE_ORDER_PROTECTED", updated, {
      protectionOrderId: protection.orderListId,
      stopLossOrderId: updated.stopLossOrderId,
      takeProfitOrderId: updated.takeProfitOrderId,
    });

    return updated;
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 300) : "LIVE_PROTECTION_FAILED";
    const failed = await markLiveOrderProtectionFailed(order.id, reason).catch(() => order);
    await tripCircuitBreaker({ ownerId, reason: "ORDER_FAILURE", detail: reason }).catch(() => undefined);
    await audit(ownerId, "TRADING_LIVE_PROTECTION_FAILED", failed, { reason });
    throw new Error(`LIVE_PROTECTION_FAILED:${reason}`);
  }
}

export async function executeApprovedLiveOrder(input: {
  ownerId: string;
  approvalId: string;
  opportunityId: string;
}): Promise<LiveExecutionResult> {
  const ownerId = input.ownerId.trim();
  const approvalId = input.approvalId.trim();
  const opportunityId = input.opportunityId.trim();
  if (!ownerId || !approvalId || !opportunityId) throw new Error("INVALID_LIVE_EXECUTION_INPUT");

  const controlResult = await getTradingControl(ownerId);
  const blockers = controlBlockReasons(controlResult.control);
  if (blockers.length > 0) throw new Error(`TRADING_CONTROL_BLOCKED:${blockers.join(",")}`);

  const preflight = await getBinanceLivePreflight();
  if (!preflight.readyForLiveExecution) {
    throw new Error(`BINANCE_LIVE_PREFLIGHT_BLOCKED:${preflight.blockers.join(",")}`);
  }

  const approval = await getConsumedOwnerApproval({ ownerId, approvalId, opportunityId });
  const amountUsd = approval.amountUsd.toNumber();
  if (!Number.isFinite(amountUsd) || amountUsd < 1) throw new Error("INVALID_APPROVAL_AMOUNT");

  const snapshot = parseExecutionSnapshot(approval.executionSnapshot);
  const riskSnapshot = parseRiskSnapshot(approval.riskSnapshot, amountUsd);
  const riskConfig = await getRiskConfig(ownerId);
  if (!riskConfig || !riskConfig.enabled) throw new Error("LIVE_RISK_CONFIG_REQUIRED");

  const riskDecision = evaluateRisk(riskConfig.config, riskSnapshot);
  if (!riskDecision.allowed) {
    throw new Error(`LIVE_RISK_BLOCKED:${riskDecision.reasons.join(",")}`);
  }

  const shariah = await checkAndRecordShariah({ actorUserId: ownerId, asset: snapshot.shariah });
  if (shariah.decision.status !== "APPROVED") {
    throw new Error(`LIVE_SHARIAH_BLOCKED:${shariah.decision.reasons.join(",")}`);
  }

  const existingKey = `${LIVE_IDEMPOTENCY_PREFIX}${approval.id}`;
  let order = await getLiveOrderByIdempotencyKey(existingKey);

  if (!order) {
    order = await createLiveOrderIntent({
      ownerId,
      approvalId: approval.id,
      opportunityId: approval.opportunityId,
      idempotencyKey: existingKey,
      symbol: snapshot.symbol,
      amountUsd,
      entryPrice: snapshot.price,
      stopLossPrice: snapshot.price * (1 - snapshot.stopLossPercent / 100),
      takeProfitPrice: snapshot.price * (1 + snapshot.takeProfitPercent / 100),
    });
  }

  if (order.status === "RECONCILIATION_MISMATCH") throw new Error("LIVE_RECONCILIATION_MISMATCH_REQUIRES_MANUAL_REVIEW");

  const adapter = new BinanceSpotLiveAdapter({
    apiKey: process.env.BINANCE_LIVE_API_KEY,
    apiSecret: process.env.BINANCE_LIVE_API_SECRET,
    liveTradingEnabled: process.env.GAMEVORTEX_LIVE_TRADING_ENABLED === "true",
  });

  if (order.status === "PROTECTED" || order.status === "CLOSED") {
    const reconciledExit = await reconcileExitIfNeeded(ownerId, order, adapter);
    return result(reconciledExit.order, reconciledExit.settlementStatus, reconciledExit.blockers);
  }

  if (order.status === "SUBMITTED" || order.status === "PARTIALLY_FILLED" || order.status === "UNKNOWN" || order.status === "SUBMITTING") {
    try {
      const observation = await adapter.getOrderStatus!({ symbol: order.symbol, clientOrderId: order.clientOrderId });
      const reconciled = await reconcileStoredLiveOrder(observation.observation);
      if (reconciled.status === "MISMATCHED") {
        await tripCircuitBreaker({ ownerId, reason: "ORDER_FAILURE", detail: reconciled.reasons.join(",") }).catch(() => undefined);
        throw new Error(`LIVE_RECONCILIATION_MISMATCH:${reconciled.reasons.join(",")}`);
      }
      if (reconciled.status === "STALE") return result(reconciled.order, "NOT_SETTLED", ["STALE_PROVIDER_OBSERVATION"]);
      order = reconciled.order;
      if (order.status === "PROTECTION_PENDING") {
        order = await protectFilledOrder(ownerId, order, snapshot, adapter);
      }
      if (order.status === "PROTECTED") {
        const reconciledExit = await reconcileExitIfNeeded(ownerId, order, adapter);
        return result(reconciledExit.order, reconciledExit.settlementStatus, reconciledExit.blockers);
      }
      return result(order);
    } catch (error) {
      return failUnknown(ownerId, order, error);
    }
  }

  if (order.status !== "INTENT_CREATED") throw new Error(`LIVE_ORDER_STATE_NOT_EXECUTABLE:${order.status}`);

  try {
    await assertBinanceLiveBuyRules({
      symbol: order.symbol,
      amountUsd,
      entryPrice: order.entryPrice.toNumber(),
    });

    await transitionLiveOrderState(order.id, "INTENT_CREATED", "SUBMITTING");
    const placed = await adapter.placeSpotBuy!({
      clientOrderId: order.clientOrderId,
      symbol: order.symbol,
      side: "BUY",
      amountUsd,
      entryPrice: order.entryPrice.toNumber(),
      stopLossPrice: order.stopLossPrice.toNumber(),
      takeProfitPrice: order.takeProfitPrice?.toNumber(),
    });

    if (!placed.providerOrderId || !placed.clientOrderId) throw new Error("LIVE_PROVIDER_ORDER_ID_REQUIRED");

    const observation = await adapter.getOrderStatus!({ symbol: order.symbol, clientOrderId: order.clientOrderId });
    const reconciled = await reconcileStoredLiveOrder(observation.observation);
    if (reconciled.status === "MISMATCHED") {
      await tripCircuitBreaker({ ownerId, reason: "ORDER_FAILURE", detail: reconciled.reasons.join(",") }).catch(() => undefined);
      throw new Error(`LIVE_RECONCILIATION_MISMATCH:${reconciled.reasons.join(",")}`);
    }
    if (reconciled.status === "STALE") return result(reconciled.order, "NOT_SETTLED", ["STALE_PROVIDER_OBSERVATION"]);

    order = reconciled.order;
    await audit(ownerId, "TRADING_LIVE_ORDER_RECONCILED", order, {
      providerStatus: order.providerStatus,
      providerOrderId: order.providerOrderId,
      executedQty: order.executedQty?.toString() ?? null,
      cumulativeQuoteQty: order.cumulativeQuoteQty?.toString() ?? null,
    });

    if (order.status === "PROTECTION_PENDING") {
      order = await protectFilledOrder(ownerId, order, snapshot, adapter);
    }

    if (order.status === "PROTECTED") {
      const reconciledExit = await reconcileExitIfNeeded(ownerId, order, adapter);
      order = reconciledExit.order;
      if (reconciledExit.settlementStatus === "BLOCKED") {
        return result(order, "BLOCKED", reconciledExit.blockers);
      }
      if (reconciledExit.settlementStatus === "EXCHANGE_CLOSED_PENDING_WALLET") {
        return result(order, "EXCHANGE_CLOSED_PENDING_WALLET");
      }
    }

    if (order.status === "REJECTED" || order.status === "CANCELED" || order.status === "EXPIRED") {
      await tripCircuitBreaker({ ownerId, reason: "ORDER_FAILURE", detail: order.status }).catch(() => undefined);
    }

    return result(order);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("LIVE_RECONCILIATION_MISMATCH:")) throw error;
    return failUnknown(ownerId, order, error);
  }
}
