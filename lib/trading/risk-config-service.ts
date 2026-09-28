import { Prisma } from "@prisma/client";
import { db } from "../prisma";
import type { RiskConfig } from "./risk";
import { validateRiskConfig } from "./risk";

type RiskRow = {
  maxTradeAmountUsd: Prisma.Decimal;
  maxDailyLossUsd: Prisma.Decimal;
  maxOpenTrades: number;
  maxExposureUsd: Prisma.Decimal;
  maxExposurePerAssetUsd: Prisma.Decimal;
  maxConsecutiveLosses: number;
  requireStopLoss: boolean;
  requireTakeProfit: boolean;
  enabled: boolean;
};

/**
 * DB Decimal(18,8) -> JS number for the pure Risk Manager. Values here are
 * owner-entered limits (few decimals), so double precision is exact enough;
 * money movement itself never goes through this conversion.
 */
export function riskRowToConfig(row: RiskRow): RiskConfig {
  return {
    maxTradeAmountUsd: row.maxTradeAmountUsd.toNumber(),
    maxDailyLossUsd: row.maxDailyLossUsd.toNumber(),
    maxOpenTrades: row.maxOpenTrades,
    maxExposureUsd: row.maxExposureUsd.toNumber(),
    maxExposurePerAssetUsd: row.maxExposurePerAssetUsd.toNumber(),
    maxConsecutiveLosses: row.maxConsecutiveLosses,
    requireStopLoss: row.requireStopLoss,
    requireTakeProfit: row.requireTakeProfit,
  };
}

export async function getRiskConfig(ownerId: string) {
  const row = await db.tradingRiskConfig.findUnique({ where: { ownerId } });
  if (!row) return null;
  return { config: riskRowToConfig(row), enabled: row.enabled, updatedAt: row.updatedAt };
}

export async function saveRiskConfig(input: { ownerId: string; config: RiskConfig }) {
  validateRiskConfig(input.config); // second line of defence behind parseRiskConfigInput

  return db.$transaction(async (tx) => {
    const before = await tx.tradingRiskConfig.findUnique({ where: { ownerId: input.ownerId } });
    const data = {
      maxTradeAmountUsd: input.config.maxTradeAmountUsd,
      maxDailyLossUsd: input.config.maxDailyLossUsd,
      maxOpenTrades: input.config.maxOpenTrades,
      maxExposureUsd: input.config.maxExposureUsd,
      maxExposurePerAssetUsd: input.config.maxExposurePerAssetUsd,
      maxConsecutiveLosses: input.config.maxConsecutiveLosses,
      requireStopLoss: input.config.requireStopLoss,
      requireTakeProfit: input.config.requireTakeProfit,
    };

    const row = await tx.tradingRiskConfig.upsert({
      where: { ownerId: input.ownerId },
      create: { ownerId: input.ownerId, ...data },
      update: data,
    });

    await tx.auditLog.create({
      data: {
        actorUserId: input.ownerId,
        action: "TRADING_RISK_CONFIG_UPDATED",
        entityType: "TradingRiskConfig",
        entityId: row.id,
        metadata: {
          before: before ? riskRowToConfig(before) : null,
          after: input.config,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    return { config: riskRowToConfig(row), enabled: row.enabled, updatedAt: row.updatedAt };
  });
}
