/**
 * GameVortex AI Trading — controlled production execution coordinator.
 *
 * This module is server-only and remains fail-closed while the live flag is
 * false, the trading control is stopped, the Shariah policy is not reviewed,
 * or Binance production preflight is not clean.
 *
 * The coordinator does not bypass wallet accounting. A fully closed exchange
 * position is settled through the allocation-backed owner-wallet settlement
 * boundary only after the provider confirms the actual protected exit fill.
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/prisma";
import { getBinanceLivePreflight } from "@/lib/trading/binance-live-preflight";
import {
  assertBinanceLiveBuyRules,
  assertBinanceLiveProtectedExitRules,
  getBinanceLiveSymbolRules,
} from "@/lib/trading/binance-live-symbol-rules";
import { attemptEmergencyExit } from "@/lib/trading/live-emergency-exit";
import { computeSellableQuantity } from "@/lib/trading/live-sellable-quantity";
import {
  DEFAULT_LIVE_MAX_SLIPPAGE_PERCENT,
  evaluateBuySlippage,
  isObservationFresh,
  resolveMaxSlippagePercent,
} from "@/lib/trading/live-slippage";
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
import { bindLiveOrderToAllocation } from "@/lib/trading/live-allocation-binding";
import { settleClosedLiveOrderToOwnerWallet } from "@/lib/trading/live-wallet-settlement";
import { releaseUnfilledLiveAllocation } from "@/lib/trading/live-unfilled-allocation-release";

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
  settlementStatus: "NOT_SETTLED" | "EXCHANGE_CLOSED_PENDING_WALLET" | "SETTLED" | "BLOCKED";
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

function positiveOrZero(value: unknown, code: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(code);
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

  const exchangeSettlement = await reconcileProtectedExitSettlement({ order, adapter });
  if (exchangeSettlement.status === "BLOCKED") {
    await tripCircuitBreaker({
      ownerId,
      reason: "ORDER_FAILURE",
      detail: exchangeSettlement.blockers.join(","),
    }).catch(() => undefined);
    await audit(ownerId, "TRADING_LIVE_EXIT_RECONCILIATION_BLOCKED", exchangeSettlement.order, {
      blockers: exchangeSettlement.blockers,
    });
    return { order: exchangeSettlement.order, settlementStatus: "BLOCKED", blockers: exchangeSettlement.blockers };
  }

  if (exchangeSettlement.status === "EXCHANGE_CLOSED_PENDING_WALLET") {
    await audit(ownerId, "TRADING_LIVE_EXCHANGE_CLOSED", exchangeSettlement.order, {
      exitPrice: exchangeSettlement.exitPrice,
      realizedPnlUsd: exchangeSettlement.realizedPnlUsd,
      settlementStatus: exchangeSettlement.status,
    });

    const walletSettlement = await settleClosedLiveOrderToOwnerWallet({
      ownerId,
      order: exchangeSettlement.order,
    });

    if (walletSettlement.status === "BLOCKED") {
      await tripCircuitBreaker({
        ownerId,
        reason: "ORDER_FAILURE",
        detail: walletSettlement.blockers.join(","),
      }).catch(() => undefined);
      await audit(ownerId, "TRADING_LIVE_WALLET_SETTLEMENT_BLOCKED", walletSettlement.order, {
        blockers: walletSettlement.blockers,
      });
      return { order: walletSettlement.order, settlementStatus: "BLOCKED", blockers: walletSettlement.blockers };
    }

    await audit(ownerId, "TRADING_LIVE_WALLET_SETTLED", walletSettlement.order, {
      settledUsd: walletSettlement.settledUsd,
      settledPoints: walletSettlement.settledPoints,
      roundingUsd: walletSettlement.roundingUsd,
    });

    return { order: walletSettlement.order, settlementStatus: "SETTLED", blockers: [] };
  }

  return { order: exchangeSettlement.order, settlementStatus: "NOT_SETTLED", blockers: [] };
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
  const filledQuantity = order.executedQty?.toFixed();
  if (!filledQuantity || Number(filledQuantity) <= 0) throw new Error("LIVE_FILLED_QUANTITY_REQUIRED");

  // Post-fill slippage: the position is already open, so this never blocks
  // protection. It stops NEW orders (circuit breaker) and leaves an audit trail.
  let postFillLimit = DEFAULT_LIVE_MAX_SLIPPAGE_PERCENT;
  try {
    postFillLimit = resolveMaxSlippagePercent(process.env.TRADING_LIVE_MAX_SLIPPAGE_PERCENT);
  } catch {
    // A misconfigured limit must never prevent protecting an open position.
  }
  const fillSlippage = evaluateBuySlippage({
    expectedPrice: order.entryPrice.toNumber(),
    observedPrice: fillPrice,
    maxPercent: postFillLimit,
  });
  if (!fillSlippage.allowed) {
    await tripCircuitBreaker({
      ownerId,
      reason: "ORDER_FAILURE",
      detail: `FILL_SLIPPAGE_EXCEEDED:${fillSlippage.slippagePercent.toFixed(4)}>${postFillLimit}`,
    }).catch(() => undefined);
    await audit(ownerId, "TRADING_LIVE_FILL_SLIPPAGE_EXCEEDED", order, {
      expectedPrice: order.entryPrice.toString(),
      fillPrice,
      slippagePercent: fillSlippage.slippagePercent,
      maxPercent: postFillLimit,
    });
  }

  let emergencyQuantity = filledQuantity;
  try {
    if (!order.providerOrderId) throw new Error("LIVE_ENTRY_PROVIDER_ORDER_ID_REQUIRED");

    // Binance may charge the BUY fee in the base asset, so only the net,
    // step-floored quantity can be sold. Using executedQty would be rejected.
    const [entryFills, symbolRules] = await Promise.all([
      adapter.getOrderTradeFills({ symbol: order.symbol, providerOrderId: order.providerOrderId }),
      getBinanceLiveSymbolRules(order.symbol),
    ]);
    const quantity = computeSellableQuantity({
      executedQty: filledQuantity,
      baseAsset: entryFills.baseAsset,
      fees: entryFills.fills.map((fill) => ({ commission: fill.commission, commissionAsset: fill.commissionAsset })),
      stepSize: symbolRules.stepSize === null ? null : symbolRules.stepSize.toFixed(12),
    });
    emergencyQuantity = quantity;

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
      protectedQuantity: quantity,
    });

    return updated;
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 300) : "LIVE_PROTECTION_FAILED";
    const failed = await markLiveOrderProtectionFailed(order.id, reason).catch(() => order);
    await tripCircuitBreaker({ ownerId, reason: "ORDER_FAILURE", detail: reason }).catch(() => undefined);
    await audit(ownerId, "TRADING_LIVE_PROTECTION_FAILED", failed, { reason });

    // The position is filled but NOT protected: try once to flatten it. This
    // never credits a wallet; settlement of an emergency exit stays manual.
    const emergency = await attemptEmergencyExit({
      adapter,
      symbol: order.symbol,
      entryClientOrderId: order.clientOrderId,
      quantity: emergencyQuantity,
    });
    await audit(
      ownerId,
      emergency.status === "SOLD" ? "TRADING_LIVE_EMERGENCY_EXIT_SOLD" : "TRADING_LIVE_EMERGENCY_EXIT_FAILED",
      failed,
      emergency.status === "SOLD"
        ? {
            clientOrderId: emergency.clientOrderId,
            providerOrderId: emergency.providerOrderId,
            executedQty: emergency.executedQty,
            cumulativeQuoteQty: emergency.cumulativeQuoteQty,
            quantity: emergencyQuantity,
          }
        : { clientOrderId: emergency.clientOrderId, reason: emergency.reason, quantity: emergencyQuantity },
    ).catch(() => undefined);

    throw new Error(
      `LIVE_PROTECTION_FAILED:${reason}:EMERGENCY_EXIT_${emergency.status}:MANUAL_REVIEW_REQUIRED`,
    );
  }
}

export async function executeApprovedLiveOrder(input: {
  ownerId: string;
  approvalId: string;
  opportunityId: string;
  /**
   * "execute" (default) may submit a new BUY. "monitor" only reconciles,
   * protects and settles an order that already exists: it can never submit a
   * BUY, and it keeps working while the emergency stop / circuit breaker is
   * active and after the approval window ends, because those states must not
   * stop an open position from being reconciled.
   */
  mode?: "execute" | "monitor";
}): Promise<LiveExecutionResult> {
  const monitorOnly = input.mode === "monitor";
  const ownerId = input.ownerId.trim();
  const approvalId = input.approvalId.trim();
  const opportunityId = input.opportunityId.trim();
  if (!ownerId || !approvalId || !opportunityId) throw new Error("INVALID_LIVE_EXECUTION_INPUT");

  if (!monitorOnly) {
    const controlResult = await getTradingControl(ownerId);
    const blockers = controlBlockReasons(controlResult.control);
    if (blockers.length > 0) throw new Error(`TRADING_CONTROL_BLOCKED:${blockers.join(",")}`);

    const preflight = await getBinanceLivePreflight();
    if (!preflight.readyForLiveExecution) {
      throw new Error(`BINANCE_LIVE_PREFLIGHT_BLOCKED:${preflight.blockers.join(",")}`);
    }
  }

  const approval = await getConsumedOwnerApproval({ ownerId, approvalId, opportunityId, allowExpired: monitorOnly });
  const amountUsd = approval.amountUsd.toNumber();
  if (!Number.isFinite(amountUsd) || amountUsd < 1) throw new Error("INVALID_APPROVAL_AMOUNT");

  const snapshot = parseExecutionSnapshot(approval.executionSnapshot);
  const riskSnapshot = parseRiskSnapshot(approval.riskSnapshot, amountUsd);
  if (!monitorOnly) {
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
  }

  const existingKey = `${LIVE_IDEMPOTENCY_PREFIX}${approval.id}`;
  let order = await getLiveOrderByIdempotencyKey(existingKey);

  if (monitorOnly && (!order || order.status === "INTENT_CREATED")) {
    throw new Error("LIVE_MONITOR_NO_ACTIVE_ORDER");
  }

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

  if (["INTENT_CREATED", "SUBMITTING", "SUBMITTED", "PARTIALLY_FILLED", "UNKNOWN", "PROTECTION_PENDING", "PROTECTED", "CLOSED"].includes(order.status)) {
    await bindLiveOrderToAllocation({ ownerId, order });
  }

  const adapter = new BinanceSpotLiveAdapter({
    apiKey: process.env.BINANCE_LIVE_API_KEY,
    apiSecret: process.env.BINANCE_LIVE_API_SECRET,
    liveTradingEnabled: process.env.GAMEVORTEX_LIVE_TRADING_ENABLED === "true",
  });

  if (order.status === "PROTECTED" || order.status === "CLOSED") {
    const reconciledExit = await reconcileExitIfNeeded(ownerId, order, adapter);
    return result(reconciledExit.order, reconciledExit.settlementStatus, reconciledExit.blockers);
  }

  if (order.status === "PROTECTION_PENDING") {
    // Filled but not yet protected (for example the process stopped right
    // after the fill). Protecting reduces risk, so it is allowed in both modes.
    order = await protectFilledOrder(ownerId, order, snapshot, adapter);
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
      if (order.status === "REJECTED" || order.status === "CANCELED" || order.status === "EXPIRED") {
        const released = await releaseUnfilledLiveAllocation({ ownerId, order });
        return result(released.order, released.released ? "SETTLED" : "NOT_SETTLED");
      }
      return result(order);
    } catch (error) {
      // Protection failures are already recorded as PROTECTION_FAILED (with an
      // emergency exit attempt). Do not overwrite that with UNKNOWN.
      if (error instanceof Error && error.message.startsWith("LIVE_PROTECTION_FAILED:")) throw error;
      return failUnknown(ownerId, order, error);
    }
  }

  if (order.status !== "INTENT_CREATED") throw new Error(`LIVE_ORDER_STATE_NOT_EXECUTABLE:${order.status}`);

  // Pre-trade guard. Runs BEFORE any state change or exchange call, so a
  // blocked order stays INTENT_CREATED and nothing is sent to Binance.
  // An invalid TRADING_LIVE_MAX_SLIPPAGE_PERCENT throws here, which blocks
  // the BUY (fail closed) instead of silently using a looser limit.
  const maxSlippagePercent = resolveMaxSlippagePercent(process.env.TRADING_LIVE_MAX_SLIPPAGE_PERCENT);
  const marketNow = await adapter.getMarketData({ symbol: order.symbol, interval: "1m", limit: 1 });
  const latestCandle = marketNow.candles[marketNow.candles.length - 1];
  if (!latestCandle || !isObservationFresh(latestCandle.timestamp, Date.now(), 180_000)) {
    throw new Error("LIVE_MARKET_DATA_STALE");
  }
  const entrySlippage = evaluateBuySlippage({
    expectedPrice: order.entryPrice.toNumber(),
    observedPrice: latestCandle.close,
    maxPercent: maxSlippagePercent,
  });
  if (!entrySlippage.allowed) {
    await audit(ownerId, "TRADING_LIVE_BUY_BLOCKED_BY_SLIPPAGE", order, {
      expectedPrice: order.entryPrice.toString(),
      observedPrice: latestCandle.close,
      slippagePercent: entrySlippage.slippagePercent,
      maxPercent: maxSlippagePercent,
      reason: entrySlippage.reason ?? null,
    }).catch(() => undefined);
    throw new Error(
      `LIVE_SLIPPAGE_BLOCKED:${entrySlippage.reason ?? "UNKNOWN"}:${Number.isFinite(entrySlippage.slippagePercent) ? entrySlippage.slippagePercent.toFixed(4) : "NaN"}%>${maxSlippagePercent}%`,
    );
  }

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
      if (reconciledExit.settlementStatus === "SETTLED") {
        return result(order, "SETTLED");
      }
      if (reconciledExit.settlementStatus === "EXCHANGE_CLOSED_PENDING_WALLET") {
        return result(order, "EXCHANGE_CLOSED_PENDING_WALLET");
      }
    }

    if (order.status === "REJECTED" || order.status === "CANCELED" || order.status === "EXPIRED") {
      const released = await releaseUnfilledLiveAllocation({ ownerId, order });
      if (released.released) return result(released.order, "SETTLED");
      await tripCircuitBreaker({ ownerId, reason: "ORDER_FAILURE", detail: order.status }).catch(() => undefined);
    }

    return result(order);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("LIVE_RECONCILIATION_MISMATCH:")) throw error;
    if (error instanceof Error && error.message.startsWith("LIVE_PROTECTION_FAILED:")) throw error;
    return failUnknown(ownerId, order, error);
  }
}
