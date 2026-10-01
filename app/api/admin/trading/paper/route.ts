import { NextRequest, NextResponse } from "next/server";
import { guardMutation } from "@/lib/api";
import { requireTradingOwner } from "@/lib/trading/access";
import { getRiskConfig } from "@/lib/trading/risk-config-service";
import { runPaperTrading, type PaperTradingTick } from "@/lib/trading/paper-trading";
import { readJsonObject, tradingRouteError } from "@/lib/trading/route-helpers";
import { DEFAULT_SHARIAH_POLICY } from "@/lib/trading/shariah";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TICKS = 10_000;

function finitePositive(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error("INVALID_PAPER_TRADING_TICK");
  }
  return value;
}

function parseTick(value: unknown): PaperTradingTick {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("INVALID_PAPER_TRADING_TICK");
  }

  const input = value as Record<string, unknown>;
  if (typeof input.timestamp !== "string" || !input.timestamp.trim()) {
    throw new Error("INVALID_PAPER_TRADING_TICK");
  }

  const shariah = input.shariah;
  if (!shariah || typeof shariah !== "object" || Array.isArray(shariah)) {
    throw new Error("INVALID_PAPER_TRADING_TICK");
  }

  const asset = shariah as Record<string, unknown>;
  if (typeof asset.symbol !== "string" || typeof asset.assetType !== "string") {
    throw new Error("INVALID_PAPER_TRADING_TICK");
  }
  if (typeof asset.tradingMethod !== "string" || typeof asset.ownershipSettlementVerified !== "boolean") {
    throw new Error("INVALID_PAPER_TRADING_TICK");
  }

  const financialRatios = asset.financialRatios;
  if (financialRatios !== undefined && (typeof financialRatios !== "object" || financialRatios === null || Array.isArray(financialRatios))) {
    throw new Error("INVALID_PAPER_TRADING_TICK");
  }

  return {
    timestamp: input.timestamp,
    price: finitePositive(input.price),
    previousPrice: finitePositive(input.previousPrice),
    fastAverage: finitePositive(input.fastAverage),
    slowAverage: finitePositive(input.slowAverage),
    volume: finitePositive(input.volume),
    averageVolume: finitePositive(input.averageVolume),
    shariah: {
      symbol: asset.symbol,
      assetType: asset.assetType,
      issuer: typeof asset.issuer === "string" ? asset.issuer : undefined,
      businessActivity: typeof asset.businessActivity === "string" ? asset.businessActivity : undefined,
      financialRatios: financialRatios as {
        interestBearingDebtRatio?: number;
        interestIncomeRatio?: number;
        impermissibleIncomeRatio?: number;
      } | undefined,
      tradingMethod: asset.tradingMethod as PaperTradingTick["shariah"]["tradingMethod"],
      ownershipSettlementVerified: asset.ownershipSettlementVerified,
      source: typeof asset.source === "string" ? asset.source : undefined,
    },
    circuitBreakerReasons: Array.isArray(input.circuitBreakerReasons)
      ? input.circuitBreakerReasons.filter((reason): reason is string => typeof reason === "string").slice(0, 20)
      : undefined,
  };
}

function parsePositive(value: unknown, code: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(code);
  return value;
}

export async function POST(request: NextRequest) {
  const blocked = await guardMutation(request, "admin:trading:paper", 10);
  if (blocked) return blocked;

  let ownerId: string | undefined;
  try {
    const owner = await requireTradingOwner();
    ownerId = owner.id;

    const riskConfig = await getRiskConfig(owner.id);
    if (!riskConfig || !riskConfig.enabled) throw new Error("PAPER_TRADING_RISK_CONFIG_REQUIRED");

    const body = await readJsonObject(request);
    if (typeof body.symbol !== "string" || !body.symbol.trim()) throw new Error("INVALID_PAPER_TRADING_INPUT");
    if (!Array.isArray(body.ticks) || body.ticks.length === 0 || body.ticks.length > MAX_TICKS) {
      throw new Error("INVALID_PAPER_TRADING_INPUT");
    }

    const ticks = body.ticks.map(parseTick);
    const config = {
      symbol: body.symbol,
      startingCapitalUsd: parsePositive(body.startingCapitalUsd, "INVALID_PAPER_TRADING_CONFIG"),
      tradeAmountUsd: parsePositive(body.tradeAmountUsd, "INVALID_PAPER_TRADING_CONFIG"),
      stopLossPercent: parsePositive(body.stopLossPercent, "INVALID_PAPER_TRADING_CONFIG"),
      takeProfitPercent: parsePositive(body.takeProfitPercent, "INVALID_PAPER_TRADING_CONFIG"),
      riskConfig: riskConfig.config,
      shariahPolicy: DEFAULT_SHARIAH_POLICY,
    };

    const result = runPaperTrading(config, ticks);

    return NextResponse.json({
      ok: true,
      mode: "PAPER_TRADING",
      simulationOnly: true,
      result,
    });
  } catch (error) {
    return tradingRouteError(error, "admin:trading:paper:post", ownerId);
  }
}
