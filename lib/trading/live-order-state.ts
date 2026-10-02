import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/prisma";
import {
  reconcileLiveOrderObservation,
  type LiveOrderIntent,
  type LiveOrderState,
  type LiveProviderOrderObservation,
} from "@/lib/trading/live-order-reconciliation";

const MIN_LIVE_ORDER_AMOUNT_USD = new Prisma.Decimal(1);

export type LiveOrderProtectionStatus = "NOT_REQUIRED" | "PENDING" | "PROTECTED" | "FAILED";

export type LiveOrderRow = {
  id: string;
  ownerId: string;
  approvalId: string;
  opportunityId: string;
  idempotencyKey: string;
  clientOrderId: string;
  providerOrderId: string | null;
  symbol: string;
  side: string;
  amountUsd: Prisma.Decimal;
  entryPrice: Prisma.Decimal;
  stopLossPrice: Prisma.Decimal;
  takeProfitPrice: Prisma.Decimal | null;
  status: LiveOrderState;
  protectionStatus: LiveOrderProtectionStatus;
  protectionOrderId: string | null;
  stopLossOrderId: string | null;
  takeProfitOrderId: string | null;
  protectionUpdatedAt: Date | null;
  protectionError: string | null;
  providerStatus: string | null;
  executedQty: Prisma.Decimal | null;
  cumulativeQuoteQty: Prisma.Decimal | null;
  averageFillPrice: Prisma.Decimal | null;
  lastProviderUpdateAt: Date | null;
  lastReconciledAt: Date | null;
  lastError: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateLiveOrderIntentInput = {
  ownerId: string;
  approvalId: string;
  opportunityId: string;
  idempotencyKey: string;
  symbol: string;
  amountUsd: string | number;
  entryPrice: string | number;
  stopLossPrice: string | number;
  takeProfitPrice?: string | number | null;
};

export type LiveOrderReconciliationResult =
  | { status: "MATCHED"; order: LiveOrderRow; nextState: LiveOrderState }
  | { status: "MISMATCHED"; order: LiveOrderRow; reasons: string[] }
  | {
      status: "STALE";
      order: LiveOrderRow;
      providerUpdatedAt: Date;
      storedProviderUpdatedAt: Date;
    };

function normalizeIdentifier(value: string, code: string, max = 200): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) throw new Error(code);
  return normalized;
}

function normalizeDecimal(
  value: string | number | Prisma.Decimal,
  code: string,
  scale: number,
): Prisma.Decimal {
  let decimal: Prisma.Decimal;
  try {
    decimal = value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
  } catch {
    throw new Error(code);
  }
  if (!decimal.isFinite() || decimal.lessThanOrEqualTo(0)) throw new Error(code);
  return decimal.toDecimalPlaces(scale);
}

function normalizeOptionalDecimal(
  value: string | number | Prisma.Decimal | null | undefined,
  code: string,
  scale: number,
): Prisma.Decimal | null {
  if (value === undefined || value === null) return null;
  return normalizeDecimal(value, code, scale);
}

function buildLiveClientOrderId(idempotencyKey: string): string {
  const digest = createHash("sha256").update(idempotencyKey, "utf8").digest("hex");
  return `gv-live-${digest.slice(0, 24)}`;
}

function sameDecimal(left: Prisma.Decimal, right: Prisma.Decimal): boolean {
  return left.eq(right);
}

function assertImmutableMatch(
  existing: LiveOrderRow,
  input: {
    ownerId: string;
    approvalId: string;
    opportunityId: string;
    clientOrderId: string;
    symbol: string;
    amountUsd: Prisma.Decimal;
    entryPrice: Prisma.Decimal;
    stopLossPrice: Prisma.Decimal;
    takeProfitPrice: Prisma.Decimal | null;
  },
): void {
  const mismatches: string[] = [];
  if (existing.ownerId !== input.ownerId) mismatches.push("OWNER_ID_MISMATCH");
  if (existing.approvalId !== input.approvalId) mismatches.push("APPROVAL_ID_MISMATCH");
  if (existing.opportunityId !== input.opportunityId) mismatches.push("OPPORTUNITY_ID_MISMATCH");
  if (existing.clientOrderId !== input.clientOrderId) mismatches.push("CLIENT_ORDER_ID_MISMATCH");
  if (existing.symbol !== input.symbol) mismatches.push("SYMBOL_MISMATCH");
  if (!sameDecimal(existing.amountUsd, input.amountUsd)) mismatches.push("AMOUNT_MISMATCH");
  if (!sameDecimal(existing.entryPrice, input.entryPrice)) mismatches.push("ENTRY_PRICE_MISMATCH");
  if (!sameDecimal(existing.stopLossPrice, input.stopLossPrice)) mismatches.push("STOP_LOSS_MISMATCH");

  if (existing.takeProfitPrice === null || input.takeProfitPrice === null) {
    if (existing.takeProfitPrice !== input.takeProfitPrice) mismatches.push("TAKE_PROFIT_MISMATCH");
  } else if (!sameDecimal(existing.takeProfitPrice, input.takeProfitPrice)) {
    mismatches.push("TAKE_PROFIT_MISMATCH");
  }

  if (mismatches.length > 0) {
    throw new Error(`LIVE_ORDER_IDEMPOTENCY_CONFLICT:${mismatches.join(",")}`);
  }
}

export function buildLiveClientOrderIdForIdempotency(idempotencyKey: string): string {
  return buildLiveClientOrderId(
    normalizeIdentifier(idempotencyKey, "INVALID_LIVE_IDEMPOTENCY_KEY", 200),
  );
}

export async function createLiveOrderIntent(
  input: CreateLiveOrderIntentInput,
): Promise<LiveOrderRow> {
  const ownerId = normalizeIdentifier(input.ownerId, "INVALID_LIVE_ORDER_OWNER");
  const approvalId = normalizeIdentifier(input.approvalId, "INVALID_LIVE_ORDER_APPROVAL");
  const opportunityId = normalizeIdentifier(input.opportunityId, "INVALID_LIVE_ORDER_OPPORTUNITY");
  const idempotencyKey = normalizeIdentifier(input.idempotencyKey, "INVALID_LIVE_IDEMPOTENCY_KEY");
  const symbol = normalizeIdentifier(input.symbol, "INVALID_LIVE_ORDER_SYMBOL", 32).toUpperCase();
  const amountUsd = normalizeDecimal(input.amountUsd, "INVALID_LIVE_ORDER_AMOUNT", 2);
  const entryPrice = normalizeDecimal(input.entryPrice, "INVALID_LIVE_ORDER_ENTRY_PRICE", 12);
  const stopLossPrice = normalizeDecimal(input.stopLossPrice, "INVALID_LIVE_ORDER_STOP_LOSS", 12);
  const takeProfitPrice = normalizeOptionalDecimal(
    input.takeProfitPrice,
    "INVALID_LIVE_ORDER_TAKE_PROFIT",
    12,
  );

  if (amountUsd.lessThan(MIN_LIVE_ORDER_AMOUNT_USD)) throw new Error("INVALID_LIVE_ORDER_AMOUNT");
  if (stopLossPrice.greaterThanOrEqualTo(entryPrice)) {
    throw new Error("INVALID_LIVE_ORDER_STOP_LOSS_FOR_BUY");
  }
  if (takeProfitPrice && takeProfitPrice.lessThanOrEqualTo(entryPrice)) {
    throw new Error("INVALID_LIVE_ORDER_TAKE_PROFIT_FOR_BUY");
  }

  const clientOrderId = buildLiveClientOrderId(idempotencyKey);
  const id = randomBytes(18).toString("base64url");

  const inserted = await db.$queryRaw<LiveOrderRow[]>(Prisma.sql`
    INSERT INTO "TradingLiveOrder" (
      "id", "ownerId", "approvalId", "opportunityId", "idempotencyKey", "clientOrderId",
      "symbol", "side", "amountUsd", "entryPrice", "stopLossPrice", "takeProfitPrice", "status"
    ) VALUES (
      ${id}, ${ownerId}, ${approvalId}, ${opportunityId}, ${idempotencyKey}, ${clientOrderId},
      ${symbol}, 'BUY', ${amountUsd.toString()}::numeric, ${entryPrice.toString()}::numeric,
      ${stopLossPrice.toString()}::numeric, ${takeProfitPrice?.toString() ?? null}::numeric,
      'INTENT_CREATED'
    )
    ON CONFLICT ("idempotencyKey") DO NOTHING
    RETURNING *
  `);

  if (inserted[0]) return inserted[0];

  const existing = await getLiveOrderByIdempotencyKey(idempotencyKey);
  if (!existing) throw new Error("LIVE_ORDER_IDEMPOTENCY_LOOKUP_FAILED");

  assertImmutableMatch(existing, {
    ownerId,
    approvalId,
    opportunityId,
    clientOrderId,
    symbol,
    amountUsd,
    entryPrice,
    stopLossPrice,
    takeProfitPrice,
  });

  return existing;
}

export async function getLiveOrderById(orderId: string): Promise<LiveOrderRow | null> {
  const rows = await db.$queryRaw<LiveOrderRow[]>(Prisma.sql`
    SELECT * FROM "TradingLiveOrder" WHERE "id" = ${orderId} LIMIT 1
  `);
  return rows[0] ?? null;
}

export async function getLiveOrderByIdempotencyKey(
  idempotencyKey: string,
): Promise<LiveOrderRow | null> {
  const rows = await db.$queryRaw<LiveOrderRow[]>(Prisma.sql`
    SELECT * FROM "TradingLiveOrder" WHERE "idempotencyKey" = ${idempotencyKey} LIMIT 1
  `);
  return rows[0] ?? null;
}

export async function getLiveOrderByClientOrderId(
  clientOrderId: string,
): Promise<LiveOrderRow | null> {
  const rows = await db.$queryRaw<LiveOrderRow[]>(Prisma.sql`
    SELECT * FROM "TradingLiveOrder" WHERE "clientOrderId" = ${clientOrderId} LIMIT 1
  `);
  return rows[0] ?? null;
}

const ALLOWED_TRANSITIONS: Record<LiveOrderState, readonly LiveOrderState[]> = {
  INTENT_CREATED: ["SUBMITTING", "UNKNOWN"],
  SUBMITTING: ["SUBMITTED", "REJECTED", "UNKNOWN"],
  SUBMITTED: ["PARTIALLY_FILLED", "FILLED", "CANCELED", "REJECTED", "EXPIRED", "UNKNOWN"],
  PARTIALLY_FILLED: ["FILLED", "CANCELED", "EXPIRED", "UNKNOWN"],
  FILLED: ["PROTECTION_PENDING", "PROTECTION_FAILED"],
  PROTECTION_PENDING: ["PROTECTED", "PROTECTION_FAILED", "UNKNOWN"],
  PROTECTED: ["CLOSED", "PROTECTED", "PROTECTION_FAILED", "UNKNOWN"],
  PROTECTION_FAILED: ["PROTECTION_PENDING", "PROTECTED", "CLOSED", "UNKNOWN"],
  CANCELED: ["CLOSED"],
  REJECTED: ["CLOSED"],
  EXPIRED: ["CLOSED"],
  UNKNOWN: ["SUBMITTED", "PARTIALLY_FILLED", "FILLED", "CANCELED", "REJECTED", "EXPIRED", "UNKNOWN"],
  RECONCILIATION_MISMATCH: [],
  CLOSED: [],
};

export async function transitionLiveOrderState(
  orderId: string,
  expectedState: LiveOrderState,
  nextState: LiveOrderState,
  reason?: string,
): Promise<LiveOrderRow> {
  normalizeIdentifier(orderId, "INVALID_LIVE_ORDER_ID");
  if (!ALLOWED_TRANSITIONS[expectedState]?.includes(nextState)) {
    throw new Error(`INVALID_LIVE_ORDER_TRANSITION:${expectedState}->${nextState}`);
  }

  const rows = await db.$queryRaw<LiveOrderRow[]>(Prisma.sql`
    UPDATE "TradingLiveOrder"
    SET
      "status" = ${nextState},
      "lastError" = ${reason ?? null},
      "version" = "version" + 1
    WHERE "id" = ${orderId} AND "status" = ${expectedState}
    RETURNING *
  `);

  const order = rows[0];
  if (!order) throw new Error("LIVE_ORDER_STATE_CONFLICT");
  return order;
}

export async function markLiveOrderProtectionPending(orderId: string): Promise<LiveOrderRow> {
  const rows = await db.$queryRaw<LiveOrderRow[]>(Prisma.sql`
    UPDATE "TradingLiveOrder"
    SET
      "status" = 'PROTECTION_PENDING',
      "protectionStatus" = 'PENDING',
      "protectionUpdatedAt" = CURRENT_TIMESTAMP,
      "protectionError" = NULL,
      "lastError" = NULL,
      "version" = "version" + 1
    WHERE "id" = ${orderId}
      AND "status" = 'FILLED'
    RETURNING *
  `);

  const order = rows[0];
  if (!order) throw new Error("LIVE_ORDER_PROTECTION_PENDING_CONFLICT");
  return order;
}

export async function markLiveOrderProtected(
  orderId: string,
  protection: {
    protectionOrderId?: string | null;
    stopLossOrderId?: string | null;
    takeProfitOrderId?: string | null;
  },
): Promise<LiveOrderRow> {
  const rows = await db.$queryRaw<LiveOrderRow[]>(Prisma.sql`
    UPDATE "TradingLiveOrder"
    SET
      "status" = 'PROTECTED',
      "protectionStatus" = 'PROTECTED',
      "protectionOrderId" = ${protection.protectionOrderId ?? null},
      "stopLossOrderId" = ${protection.stopLossOrderId ?? null},
      "takeProfitOrderId" = ${protection.takeProfitOrderId ?? null},
      "protectionUpdatedAt" = CURRENT_TIMESTAMP,
      "protectionError" = NULL,
      "lastError" = NULL,
      "version" = "version" + 1
    WHERE "id" = ${orderId}
      AND "status" = 'PROTECTION_PENDING'
      AND "protectionStatus" = 'PENDING'
    RETURNING *
  `);

  const order = rows[0];
  if (!order) throw new Error("LIVE_ORDER_PROTECTION_CONFIRM_CONFLICT");
  return order;
}

export async function markLiveOrderProtectionFailed(
  orderId: string,
  reason: string,
): Promise<LiveOrderRow> {
  const normalizedReason = normalizeIdentifier(reason, "INVALID_LIVE_PROTECTION_ERROR", 500);
  const rows = await db.$queryRaw<LiveOrderRow[]>(Prisma.sql`
    UPDATE "TradingLiveOrder"
    SET
      "status" = 'PROTECTION_FAILED',
      "protectionStatus" = 'FAILED',
      "protectionUpdatedAt" = CURRENT_TIMESTAMP,
      "protectionError" = ${normalizedReason},
      "lastError" = ${normalizedReason},
      "version" = "version" + 1
    WHERE "id" = ${orderId}
      AND "status" IN ('PROTECTION_PENDING', 'PROTECTION_FAILED')
    RETURNING *
  `);

  const order = rows[0];
  if (!order) throw new Error("LIVE_ORDER_PROTECTION_FAILURE_CONFLICT");
  return order;
}

export async function markLiveOrderUnknown(
  orderId: string,
  reason: string,
): Promise<LiveOrderRow> {
  const normalizedReason = normalizeIdentifier(reason, "INVALID_LIVE_ORDER_UNKNOWN_REASON", 500);

  const rows = await db.$queryRaw<LiveOrderRow[]>(Prisma.sql`
    UPDATE "TradingLiveOrder"
    SET "status" = 'UNKNOWN', "lastError" = ${normalizedReason}, "version" = "version" + 1
    WHERE "id" = ${orderId}
      AND "status" IN ('INTENT_CREATED', 'SUBMITTING', 'SUBMITTED', 'PARTIALLY_FILLED', 'PROTECTION_PENDING', 'PROTECTION_FAILED')
    RETURNING *
  `);

  const order = rows[0];
  if (!order) throw new Error("LIVE_ORDER_UNKNOWN_STATE_CONFLICT");
  return order;
}

export async function reconcileStoredLiveOrder(
  observation: LiveProviderOrderObservation,
): Promise<LiveOrderReconciliationResult> {
  const order = await getLiveOrderByClientOrderId(observation.clientOrderId);
  if (!order) throw new Error("LIVE_ORDER_NOT_FOUND");

  const providerUpdatedAt =
    observation.updatedAt instanceof Date ? observation.updatedAt : new Date(observation.updatedAt);
  if (Number.isNaN(providerUpdatedAt.getTime())) throw new Error("INVALID_PROVIDER_UPDATE_TIME");

  if (order.lastProviderUpdateAt && providerUpdatedAt.getTime() < order.lastProviderUpdateAt.getTime()) {
    return {
      status: "STALE",
      order,
      providerUpdatedAt,
      storedProviderUpdatedAt: order.lastProviderUpdateAt,
    };
  }

  const intent: LiveOrderIntent = {
    clientOrderId: order.clientOrderId,
    providerOrderId: order.providerOrderId,
    symbol: order.symbol,
    side: "BUY",
  };

  const reconciliation = reconcileLiveOrderObservation(intent, observation);

  if (reconciliation.status === "MISMATCHED") {
    const rows = await db.$queryRaw<LiveOrderRow[]>(Prisma.sql`
      UPDATE "TradingLiveOrder"
      SET
        "status" = 'RECONCILIATION_MISMATCH',
        "providerStatus" = ${observation.status},
        "lastProviderUpdateAt" = ${providerUpdatedAt},
        "lastReconciledAt" = CURRENT_TIMESTAMP,
        "lastError" = ${reconciliation.reasons.join(",")},
        "version" = "version" + 1
      WHERE "id" = ${order.id}
      RETURNING *
    `);

    const updated = rows[0];
    if (!updated) throw new Error("LIVE_ORDER_RECONCILIATION_UPDATE_FAILED");
    return { status: "MISMATCHED", order: updated, reasons: reconciliation.reasons };
  }

  const executedQty = new Prisma.Decimal(observation.executedQty);
  const cumulativeQuoteQty = new Prisma.Decimal(observation.cumulativeQuoteQty);
  const averageFillPrice =
    observation.averageFillPrice === undefined || observation.averageFillPrice === null
      ? null
      : new Prisma.Decimal(observation.averageFillPrice);

  const nextState: LiveOrderState =
    reconciliation.nextState === "FILLED" ? "PROTECTION_PENDING" : reconciliation.nextState;

  const rows = await db.$queryRaw<LiveOrderRow[]>(Prisma.sql`
    UPDATE "TradingLiveOrder"
    SET
      "providerOrderId" = ${reconciliation.providerOrderId},
      "status" = ${nextState},
      "protectionStatus" = CASE WHEN ${nextState} = 'PROTECTION_PENDING' THEN 'PENDING' ELSE "protectionStatus" END,
      "protectionUpdatedAt" = CASE WHEN ${nextState} = 'PROTECTION_PENDING' THEN CURRENT_TIMESTAMP ELSE "protectionUpdatedAt" END,
      "providerStatus" = ${reconciliation.providerStatus},
      "executedQty" = ${executedQty.toString()}::numeric,
      "cumulativeQuoteQty" = ${cumulativeQuoteQty.toString()}::numeric,
      "averageFillPrice" = ${averageFillPrice?.toString() ?? null}::numeric,
      "lastProviderUpdateAt" = ${providerUpdatedAt},
      "lastReconciledAt" = CURRENT_TIMESTAMP,
      "lastError" = NULL,
      "version" = "version" + 1
    WHERE "id" = ${order.id} AND "status" <> 'RECONCILIATION_MISMATCH'
    RETURNING *
  `);

  const updated = rows[0];
  if (!updated) throw new Error("LIVE_ORDER_RECONCILIATION_UPDATE_FAILED");

  return { status: "MATCHED", order: updated, nextState };
}
