import { NextRequest, NextResponse } from "next/server";
import { guardMutation } from "@/lib/api";
import { requireTradingOwner } from "@/lib/trading/access";
import { getBinanceSpotTestnetAdapter } from "@/lib/trading/binance-spot-testnet-config";
import { buildOwnerPaperOpportunityFromApproval } from "@/lib/trading/opportunity-service";
import { readJsonObject, tradingRouteError } from "@/lib/trading/route-helpers";
import type { ShariahAssetInput, TradingMethod } from "@/lib/trading/shariah";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TRADING_METHODS: readonly TradingMethod[] = [
  "SPOT",
  "MARGIN",
  "LEVERAGED",
  "SHORT",
  "FUTURES",
  "OPTIONS",
  "UNKNOWN",
];

function requiredString(value: unknown, code: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value.trim();
}

function positiveNumber(value: unknown, code: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(code);
  return value;
}

function object(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
}

function parseShariah(value: unknown): ShariahAssetInput {
  const input = object(value, "INVALID_SHARIAH_INPUT");
  const tradingMethod = requiredString(input.tradingMethod, "INVALID_SHARIAH_INPUT");
  if (!TRADING_METHODS.includes(tradingMethod as TradingMethod)) throw new Error("INVALID_SHARIAH_INPUT");
  if (typeof input.ownershipSettlementVerified !== "boolean") throw new Error("INVALID_SHARIAH_INPUT");

  const financialRatios = input.financialRatios;
  if (
    financialRatios !== undefined &&
    (!financialRatios || typeof financialRatios !== "object" || Array.isArray(financialRatios))
  ) {
    throw new Error("INVALID_SHARIAH_INPUT");
  }

  return {
    symbol: requiredString(input.symbol, "INVALID_SHARIAH_INPUT"),
    assetType: requiredString(input.assetType, "INVALID_SHARIAH_INPUT"),
    issuer: typeof input.issuer === "string" ? input.issuer.trim() : undefined,
    businessActivity: typeof input.businessActivity === "string" ? input.businessActivity.trim() : undefined,
    financialRatios: financialRatios as ShariahAssetInput["financialRatios"],
    tradingMethod: tradingMethod as TradingMethod,
    ownershipSettlementVerified: input.ownershipSettlementVerified,
    source: typeof input.source === "string" ? input.source.trim() : undefined,
  };
}

export async function POST(request: NextRequest) {
  const blocked = await guardMutation(request, "admin:trading:exchange:testnet:preflight", 10);
  if (blocked) return blocked;

  let ownerId: string | undefined;
  try {
    const owner = await requireTradingOwner();
    ownerId = owner.id;
    const body = await readJsonObject(request);

    const approvalId = requiredString(body.approvalId, "INVALID_APPROVAL_INPUT");
    const opportunityId = requiredString(body.opportunityId, "INVALID_APPROVAL_INPUT");
    const strategyInput = object(body.strategy, "INVALID_OPPORTUNITY_STRATEGY");

    const strategy = {
      price: positiveNumber(strategyInput.price, "INVALID_OPPORTUNITY_STRATEGY"),
      previousPrice: positiveNumber(strategyInput.previousPrice, "INVALID_OPPORTUNITY_STRATEGY"),
      fastAverage: positiveNumber(strategyInput.fastAverage, "INVALID_OPPORTUNITY_STRATEGY"),
      slowAverage: positiveNumber(strategyInput.slowAverage, "INVALID_OPPORTUNITY_STRATEGY"),
      volume: positiveNumber(strategyInput.volume, "INVALID_OPPORTUNITY_STRATEGY"),
      averageVolume: positiveNumber(strategyInput.averageVolume, "INVALID_OPPORTUNITY_STRATEGY"),
      stopLossPercent: positiveNumber(strategyInput.stopLossPercent, "INVALID_OPPORTUNITY_STRATEGY"),
      takeProfitPercent: positiveNumber(strategyInput.takeProfitPercent, "INVALID_OPPORTUNITY_STRATEGY"),
    };

    const shariah = parseShariah(body.shariah);
    const opportunity = await buildOwnerPaperOpportunityFromApproval({
      ownerId: owner.id,
      approvalId,
      opportunityId,
      strategy,
      shariah,
    });

    const adapter = getBinanceSpotTestnetAdapter();
    const account = await adapter.getAccountStatus();
    const hasSpotPermission = account.permissions.includes("SPOT");
    const readyForTestnetOrder =
      account.canTrade && !account.canWithdraw && hasSpotPermission;

    return NextResponse.json({
      ok: true,
      testnetOnly: true,
      realMoney: false,
      executionPerformed: false,
      readyForTestnetOrder,
      account: {
        canTrade: account.canTrade,
        canWithdraw: account.canWithdraw,
        canDeposit: account.canDeposit,
        accountType: account.accountType,
        permissions: account.permissions,
      },
      proposal: opportunity.proposal,
      executionPlan: opportunity.executionPlan,
    });
  } catch (error) {
    return tradingRouteError(error, "admin:trading:exchange:testnet:preflight:post", ownerId);
  }
}
