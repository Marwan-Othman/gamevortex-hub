import { Prisma } from "@prisma/client";
import { db } from "@/lib/prisma";
import {
  buildOwnerPaperOpportunity,
  type TradeOpportunityResult,
} from "@/lib/trading/opportunity-pipeline";
import { getRiskConfig } from "@/lib/trading/risk-config-service";
import type { RiskSnapshot } from "@/lib/trading/risk";
import type { ShariahAssetInput } from "@/lib/trading/shariah";
import type { OwnerExecutionSnapshot } from "@/lib/trading/approval-store";

export type ConsumedOwnerApproval = {
  id: string;
  opportunityId: string;
  ownerId: string;
  amountUsd: Prisma.Decimal;
  issuedAt: Date;
  expiresAt: Date;
  consumedAt: Date;
  status: "CONSUMED";
  strategyVersion: string | null;
  shariahStatus: "APPROVED";
  riskSnapshot: Prisma.JsonValue;
  executionSnapshot: Prisma.JsonValue;
};

type ApprovalRow = Omit<ConsumedOwnerApproval, "status" | "shariahStatus"> & {
  status: string;
  shariahStatus: string;
};

function asObject(value: Prisma.JsonValue | null): Prisma.JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("APPROVAL_RISK_SNAPSHOT_REQUIRED");
  return value as Prisma.JsonObject;
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function parseRiskSnapshot(value: Prisma.JsonValue | null): RiskSnapshot {
  const snapshot = asObject(value);
  const numericKeys = ["requestedAmountUsd", "dailyLossUsd", "openTrades", "totalExposureUsd", "assetExposureUsd", "consecutiveLosses"] as const;
  for (const key of numericKeys) if (!finiteNonNegative(snapshot[key])) throw new Error("INVALID_APPROVAL_RISK_SNAPSHOT");
  if (typeof snapshot.hasStopLoss !== "boolean" || typeof snapshot.hasTakeProfit !== "boolean") throw new Error("INVALID_APPROVAL_RISK_SNAPSHOT");
  const circuitBreakerReasons = snapshot.circuitBreakerReasons;
  if (circuitBreakerReasons !== undefined && (!Array.isArray(circuitBreakerReasons) || circuitBreakerReasons.some((reason) => typeof reason !== "string"))) {
    throw new Error("INVALID_APPROVAL_RISK_SNAPSHOT");
  }
  return {
    requestedAmountUsd: snapshot.requestedAmountUsd as number,
    dailyLossUsd: snapshot.dailyLossUsd as number,
    openTrades: snapshot.openTrades as number,
    totalExposureUsd: snapshot.totalExposureUsd as number,
    assetExposureUsd: snapshot.assetExposureUsd as number,
    consecutiveLosses: snapshot.consecutiveLosses as number,
    hasStopLoss: snapshot.hasStopLoss,
    hasTakeProfit: snapshot.hasTakeProfit,
    circuitBreakerReasons: circuitBreakerReasons as string[] | undefined,
  };
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(",`)}}`;
}

function buildExecutionSnapshot(input: {
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
}): OwnerExecutionSnapshot {
  return {
    symbol: input.shariah.symbol,
    price: input.strategy.price,
    previousPrice: input.strategy.previousPrice,
    fastAverage: input.strategy.fastAverage,
    slowAverage: input.strategy.slowAverage,
    volume: input.strategy.volume,
    averageVolume: input.strategy.averageVolume,
    stopLossPercent: input.strategy.stopLossPercent,
    takeProfitPercent: input.strategy.takeProfitPercent,
    shariah: input.shariah as unknown as Prisma.JsonObject,
  };
}

function assertExecutionSnapshotMatches(approval: Prisma.JsonValue | null, input: {
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
}) {
  if (!approval || typeof approval !== "object" || Array.isArray(approval)) throw new Error("APPROVAL_EXECUTION_SNAPSHOT_REQUIRED");
  const expected = buildExecutionSnapshot(input);
  if (stableJson(approval) !== stableJson(expected)) throw new Error("APPROVAL_EXECUTION_SNAPSHOT_MISMATCH");
}

export async function getConsumedOwnerApproval(input: { ownerId: string; approvalId: string; opportunityId: string }): Promise<ConsumedOwnerApproval> {
  if (!input.ownerId.trim() || !input.approvalId.trim() || !input.opportunityId.trim()) throw new Error("INVALID_APPROVAL_INPUT");
  const rows = await db.$queryRaw<ApprovalRow[]>(Prisma.sql`
    SELECT "id", "opportunityId", "ownerId", "amountUsd", "issuedAt", "expiresAt", "consumedAt", "status", "strategyVersion", "shariahStatus", "riskSnapshot", "executionSnapshot"
    FROM "TradingApproval"
    WHERE "id" = ${input.approvalId.trim()} AND "ownerId" = ${input.ownerId.trim()} AND "opportunityId" = ${input.opportunityId.trim()}
    LIMIT 1
  `);
  const approval = rows[0];
  if (!approval) throw new Error("APPROVAL_NOT_FOUND");
  if (approval.status !== "CONSUMED" || !approval.consumedAt) throw new Error("OWNER_APPROVAL_NOT_CONSUMED");
  if (approval.expiresAt.getTime() <= Date.now()) throw new Error("APPROVAL_EXPIRED");
  if (approval.shariahStatus !== "APPROVED") throw new Error("SHARIAH_APPROVAL_REQUIRED");
  return { ...approval, status: "CONSUMED", shariahStatus: "APPROVED", consumedAt: approval.consumedAt, riskSnapshot: approval.riskSnapshot ?? null, executionSnapshot: approval.executionSnapshot ?? null } as ConsumedOwnerApproval;
}

export async function buildOwnerPaperOpportunityFromApproval(input: {
  ownerId: string;
  approvalId: string;
  opportunityId: string;
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
}): Promise<TradeOpportunityResult> {
  const [approval, riskConfig] = await Promise.all([
    getConsumedOwnerApproval({ ownerId: input.ownerId, approvalId: input.approvalId, opportunityId: input.opportunityId }),
    getRiskConfig(input.ownerId),
  ]);
  if (!riskConfig || !riskConfig.enabled) throw new Error("PAPER_TRADING_RISK_CONFIG_REQUIRED");
  const amountUsd = Number(approval.amountUsd);
  if (!Number.isFinite(amountUsd) || amountUsd < 1) throw new Error("INVALID_APPROVAL_AMOUNT");
  const riskSnapshot = parseRiskSnapshot(approval.riskSnapshot);
  if (riskSnapshot.requestedAmountUsd !== amountUsd) throw new Error("APPROVAL_AMOUNT_MISMATCH");
  assertExecutionSnapshotMatches(approval.executionSnapshot, { strategy: input.strategy, shariah: input.shariah });

  const result = buildOwnerPaperOpportunity({
    ownerId: input.ownerId,
    opportunityId: input.opportunityId,
    idempotencyKey: `paper-opportunity:${approval.id}`,
    symbol: input.shariah.symbol,
    amountUsd,
    strategy: input.strategy,
    shariah: input.shariah,
    riskConfig: riskConfig.config,
    riskSnapshot,
    approval: { id: approval.id, ownerId: approval.ownerId, opportunityId: approval.opportunityId, status: "CONSUMED", amountUsd, consumedAt: approval.consumedAt.toISOString() },
  });

  await db.auditLog.create({
    data: {
      actorUserId: input.ownerId,
      action: "TRADING_PAPER_OPPORTUNITY_BUILT",
      entityType: "TradingApproval",
      entityId: approval.id,
      metadata: { opportunityId: approval.opportunityId, amountUsd, symbol: input.shariah.symbol, executionMode: "PAPER", clientOrderId: result.executionPlan?.clientOrderId ?? null },
    },
  });
  return result;
}
