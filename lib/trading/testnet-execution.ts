/**
 * GameVortex AI Trading — guarded Binance Spot Testnet execution.
 *
 * This is a testnet-only execution bridge. It deliberately reuses the
 * existing owner-approval + Shariah + risk + execution-plan gates before it
 * sends a Spot BUY to Binance Spot Testnet. It never touches production
 * exchange endpoints and never mutates the GameVortex wallet.
 *
 * A successful result proves only that the guarded Testnet execution path
 * works. It is not evidence that LIVE trading is safe or enabled.
 */

import { db } from "@/lib/prisma";
import { getBinanceSpotTestnetAdapter } from "@/lib/trading/binance-spot-testnet-config";
import { buildOwnerPaperOpportunityFromApproval } from "@/lib/trading/opportunity-service";
import type { ShariahAssetInput } from "@/lib/trading/shariah";

export type TestnetExecutionInput = {
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
};

export type TestnetExecutionResult = {
  venue: "BINANCE_SPOT_TESTNET";
  realMoney: false;
  clientOrderId: string;
  providerOrderId: string;
  status: "FILLED";
  symbol: string;
  amountUsd: number;
};

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function assertStrategyInput(input: TestnetExecutionInput): void {
  if (!input.ownerId.trim() || !input.approvalId.trim() || !input.opportunityId.trim()) {
    throw new Error("INVALID_TESTNET_EXECUTION_IDENTITY");
  }

  const values = Object.values(input.strategy);
  if (values.some((value) => !positiveFinite(value))) {
    throw new Error("INVALID_TESTNET_EXECUTION_STRATEGY");
  }
}

export async function executeOwnerBinanceSpotTestnetBuy(
  input: TestnetExecutionInput,
): Promise<TestnetExecutionResult> {
  assertStrategyInput(input);

  const opportunity = await buildOwnerPaperOpportunityFromApproval({
    ownerId: input.ownerId.trim(),
    approvalId: input.approvalId.trim(),
    opportunityId: input.opportunityId.trim(),
    strategy: input.strategy,
    shariah: input.shariah,
  });

  const plan = opportunity.executionPlan;
  if (!plan) throw new Error("TESTNET_EXECUTION_PLAN_REQUIRED");
  if (!plan.preTrade.allowed) {
    throw new Error(`PRE_TRADE_BLOCKED:${plan.preTrade.reasons.join(",")}`);
  }

  const adapter = getBinanceSpotTestnetAdapter();
  const account = await adapter.getAccountStatus();
  const isSpotAccount = account.accountType === "SPOT";
  const hasSpotPermission = account.permissions.includes("SPOT");

  if (!isSpotAccount) throw new Error("BINANCE_TESTNET_SPOT_ACCOUNT_REQUIRED");
  if (!account.canTrade) throw new Error("BINANCE_TESTNET_TRADING_DISABLED");
  // Spot Testnet keys cannot disable the withdraw flag and its funds are virtual (non-transferable), so this check is not applied to Testnet. It is still enforced for live trading (binance-live-preflight / live-execution-gate).
  if (!hasSpotPermission) throw new Error("BINANCE_TESTNET_SPOT_PERMISSION_REQUIRED");

  const order = await adapter.placeSpotBuy({
    clientOrderId: plan.clientOrderId,
    symbol: plan.symbol,
    side: "BUY",
    amountUsd: plan.amountUsd,
    entryPrice: plan.entryPrice,
    stopLossPrice: plan.stopLossPrice,
    takeProfitPrice: plan.takeProfitPrice,
  });

  if (!order.accepted || order.status !== "FILLED" || !order.providerOrderId) {
    throw new Error("BINANCE_TESTNET_ORDER_NOT_CONFIRMED");
  }

  await db.auditLog.create({
    data: {
      actorUserId: input.ownerId.trim(),
      action: "TRADING_TESTNET_ORDER_FILLED",
      entityType: "TradingApproval",
      entityId: input.approvalId.trim(),
      metadata: {
        venue: "BINANCE_SPOT_TESTNET",
        realMoney: false,
        opportunityId: input.opportunityId.trim(),
        clientOrderId: order.clientOrderId,
        providerOrderId: order.providerOrderId,
        symbol: plan.symbol,
        amountUsd: plan.amountUsd,
        side: "BUY",
        orderType: "SPOT_MARKET",
        withdrawalPermission: false,
        leverage: 1,
        margin: false,
        short: false,
      },
    },
  });

  return {
    venue: "BINANCE_SPOT_TESTNET",
    realMoney: false,
    clientOrderId: order.clientOrderId,
    providerOrderId: order.providerOrderId,
    status: "FILLED",
    symbol: plan.symbol,
    amountUsd: plan.amountUsd,
  };
}
