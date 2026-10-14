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

import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
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

type TestnetOrderRow = {
  id: string;
  ownerId: string;
  approvalId: string;
  opportunityId: string;
  idempotencyKey: string;
  clientOrderId: string;
  providerOrderId: string | null;
  symbol: string;
  amountUsd: Prisma.Decimal;
  status: string;
  lastError: string | null;
};

function testnetIdempotencyKey(approvalId: string): string {
  return "testnet-approval-" + createHash("sha256").update(approvalId, "utf8").digest("hex").slice(0, 32);
}

async function claimTestnetOrder(input: {
  ownerId: string;
  approvalId: string;
  opportunityId: string;
  clientOrderId: string;
  symbol: string;
  amountUsd: number;
}): Promise<void> {
  const idempotencyKey = testnetIdempotencyKey(input.approvalId);
  const id = randomBytes(18).toString("base64url");
  const inserted = await db.$queryRaw<TestnetOrderRow[]>(Prisma.sql`
    INSERT INTO "TradingTestnetOrder" (
      "id", "ownerId", "approvalId", "opportunityId", "idempotencyKey",
      "clientOrderId", "symbol", "amountUsd", "status"
    ) VALUES (
      ${id}, ${input.ownerId}, ${input.approvalId}, ${input.opportunityId},
      ${idempotencyKey}, ${input.clientOrderId}, ${input.symbol},
      ${input.amountUsd.toFixed(2)}::numeric, 'INTENT_CREATED'
    )
    ON CONFLICT ("approvalId") DO NOTHING
    RETURNING *
  `);

  let order = inserted[0];
  if (!order) {
    const existing = await db.$queryRaw<TestnetOrderRow[]>(Prisma.sql`
      SELECT * FROM "TradingTestnetOrder" WHERE "approvalId" = ${input.approvalId} LIMIT 1
    `);
    order = existing[0];
    if (!order) throw new Error("TESTNET_ORDER_IDEMPOTENCY_LOOKUP_FAILED");

    const mismatches: string[] = [];
    if (order.ownerId !== input.ownerId) mismatches.push("OWNER_ID_MISMATCH");
    if (order.opportunityId !== input.opportunityId) mismatches.push("OPPORTUNITY_ID_MISMATCH");
    if (order.clientOrderId !== input.clientOrderId) mismatches.push("CLIENT_ORDER_ID_MISMATCH");
    if (order.symbol !== input.symbol) mismatches.push("SYMBOL_MISMATCH");
    if (!new Prisma.Decimal(order.amountUsd).eq(input.amountUsd)) mismatches.push("AMOUNT_MISMATCH");
    if (mismatches.length) {
      throw new Error("TESTNET_ORDER_IDEMPOTENCY_CONFLICT:" + mismatches.join(","));
    }
  }

  // The CAS claim is the single-writer boundary. Once SUBMITTING is persisted,
  // no request may submit another BUY for this approval, even after a timeout.
  const claimed = await db.$queryRaw<TestnetOrderRow[]>(Prisma.sql`
    UPDATE "TradingTestnetOrder"
    SET "status" = 'SUBMITTING', "submittedAt" = CURRENT_TIMESTAMP,
        "updatedAt" = CURRENT_TIMESTAMP, "lastError" = NULL
    WHERE "approvalId" = ${input.approvalId} AND "status" = 'INTENT_CREATED'
    RETURNING *
  `);
  if (!claimed[0]) throw new Error("TESTNET_ORDER_ALREADY_CLAIMED_OR_TERMINAL");
}

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

  await claimTestnetOrder({
    ownerId: input.ownerId.trim(),
    approvalId: input.approvalId.trim(),
    opportunityId: input.opportunityId.trim(),
    clientOrderId: plan.clientOrderId,
    symbol: plan.symbol,
    amountUsd: plan.amountUsd,
  });

  let order: Awaited<ReturnType<typeof adapter.placeSpotBuy>>;
  try {
    order = await adapter.placeSpotBuy({
      clientOrderId: plan.clientOrderId,
      symbol: plan.symbol,
      side: "BUY",
      amountUsd: plan.amountUsd,
      entryPrice: plan.entryPrice,
      stopLossPrice: plan.stopLossPrice,
      takeProfitPrice: plan.takeProfitPrice,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 500) : "TESTNET_PROVIDER_OUTCOME_UNKNOWN";
    await db.$executeRaw(Prisma.sql`
      UPDATE "TradingTestnetOrder"
      SET "status" = 'UNKNOWN', "lastError" = ${reason}, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "approvalId" = ${input.approvalId.trim()} AND "status" = 'SUBMITTING'
    `);
    // Never retry an ambiguous provider outcome with a new submission.
    throw new Error("TESTNET_ORDER_OUTCOME_UNKNOWN");
  }

  if (!order.accepted || order.status !== "FILLED" || !order.providerOrderId) {
    await db.$executeRaw(Prisma.sql`
      UPDATE "TradingTestnetOrder"
      SET "status" = 'UNKNOWN', "lastError" = 'BINANCE_TESTNET_ORDER_NOT_CONFIRMED',
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "approvalId" = ${input.approvalId.trim()} AND "status" = 'SUBMITTING'
    `);
    throw new Error("BINANCE_TESTNET_ORDER_NOT_CONFIRMED");
  }

  const persisted = await db.$queryRaw<TestnetOrderRow[]>(Prisma.sql`
    UPDATE "TradingTestnetOrder"
    SET "status" = 'FILLED', "providerOrderId" = ${order.providerOrderId},
        "updatedAt" = CURRENT_TIMESTAMP, "lastError" = NULL, "confirmedAt" = CURRENT_TIMESTAMP
    WHERE "approvalId" = ${input.approvalId.trim()} AND "status" = 'SUBMITTING'
    RETURNING *
  `);
  if (!persisted[0]) {
    // Provider accepted the order but durable confirmation failed. Keep the
    // intent non-retryable and require manual/provider reconciliation.
    throw new Error("TESTNET_ORDER_PERSISTENCE_UNCERTAIN");
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
