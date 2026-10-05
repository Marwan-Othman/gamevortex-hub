/**
 * GameVortex AI Trading — prepare a manual live order for the account owner.
 *
 * This DOES NOT send any order. It runs every pre-trade check the executor
 * will run again later (so mistakes show up early, before any exchange call),
 * then creates a short-lived owner approval. The real BUY only happens when
 * the owner consumes that approval and types the confirmation phrase.
 */

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/prisma";
import { controlBlockReasons } from "@/lib/trading/control";
import { getTradingControl } from "@/lib/trading/control-service";
import { getRiskConfig } from "@/lib/trading/risk-config-service";
import { evaluateRisk } from "@/lib/trading/risk";
import { checkAndRecordShariah } from "@/lib/trading/shariah-service";
import { assertBinanceLiveBuyRules } from "@/lib/trading/binance-live-symbol-rules";
import { createOwnerApproval, type OwnerExecutionSnapshot } from "@/lib/trading/approval-store";
import { fetchPublicKlines } from "@/lib/trading/binance-public-market-data";
import { hasBinanceSigningCredential, signBinancePayload } from "@/lib/trading/binance-signer";
import { isLiveDirectFundingEnabled } from "@/lib/trading/live-direct-funding";
import {
  buildLiveRiskSnapshot,
  buildMarketSnapshot,
  normalizeLiveSymbol,
  parseLiveAmountUsd,
  parseLivePercent,
  type LiveOrderForRisk,
} from "@/lib/trading/live-prepare-math";

const APPROVAL_TTL_SECONDS = 240;
const STRATEGY_VERSION = "owner-manual-v1";

export type PreparedLiveOrder = {
  approvalId: string;
  opportunityId: string;
  token: string;
  expiresAt: string;
  fundingMode: "DIRECT" | "WALLET";
  summary: {
    symbol: string;
    amountUsd: number;
    entryPrice: number;
    stopLossPercent: number;
    takeProfitPercent: number;
    stopLossPrice: number;
    takeProfitPrice: number;
    quoteFreeBalanceUsd: number;
  };
};

async function fetchUsdtFreeBalance(): Promise<number> {
  const apiKey = process.env.BINANCE_LIVE_API_KEY?.trim();
  const credentials = {
    apiPrivateKeyPem: process.env.BINANCE_LIVE_API_PRIVATE_KEY?.trim(),
    apiSecret: process.env.BINANCE_LIVE_API_SECRET?.trim(),
  };
  if (!apiKey || !hasBinanceSigningCredential(credentials)) throw new Error("BINANCE_LIVE_API_CREDENTIALS_REQUIRED");

  const query = `recvWindow=5000&timestamp=${Date.now()}`;
  const signature = signBinancePayload(query, credentials);

  let response: Response;
  try {
    response = await fetch(`https://api.binance.com/api/v3/account?${query}&signature=${encodeURIComponent(signature)}`, {
      method: "GET",
      headers: { Accept: "application/json", "X-MBX-APIKEY": apiKey },
      cache: "no-store",
    });
  } catch {
    throw new Error("BINANCE_LIVE_NETWORK_ERROR");
  }
  if (!response.ok) throw new Error("BINANCE_LIVE_PROVIDER_ERROR");

  const payload = (await response.json()) as { balances?: Array<{ asset?: string; free?: string }> };
  const usdt = payload.balances?.find((balance) => balance.asset === "USDT");
  const free = Number(usdt?.free ?? 0);
  return Number.isFinite(free) ? free : 0;
}

async function loadOrdersForRisk(ownerId: string): Promise<LiveOrderForRisk[]> {
  const rows = await db.$queryRaw<
    Array<{
      symbol: string;
      amountUsd: Prisma.Decimal;
      status: string;
      realizedPnlUsd: Prisma.Decimal | null;
      updatedAt: Date;
    }>
  >(Prisma.sql`
    SELECT "symbol", "amountUsd", "status", "realizedPnlUsd", "updatedAt"
    FROM "TradingLiveOrder"
    WHERE "ownerId" = ${ownerId}
    ORDER BY "createdAt" DESC
    LIMIT 200
  `);

  return rows.map((row) => ({
    symbol: row.symbol,
    amountUsd: Number(row.amountUsd.toString()),
    status: row.status,
    realizedPnlUsd: row.realizedPnlUsd === null ? null : Number(row.realizedPnlUsd.toString()),
    updatedAt: row.updatedAt,
  }));
}

export async function prepareLiveOrder(input: {
  ownerId: string;
  symbol: unknown;
  amountUsd: unknown;
  stopLossPercent: unknown;
  takeProfitPercent: unknown;
  ackOwnerSpot: unknown;
}): Promise<PreparedLiveOrder> {
  const symbol = normalizeLiveSymbol(input.symbol);
  const amountUsd = parseLiveAmountUsd(input.amountUsd);
  const stopLossPercent = parseLivePercent(input.stopLossPercent, 0.1, 20, "INVALID_LIVE_ORDER_STOP_LOSS");
  const takeProfitPercent = parseLivePercent(input.takeProfitPercent, 0.2, 50, "INVALID_LIVE_ORDER_TAKE_PROFIT");
  if (input.ackOwnerSpot !== true) throw new Error("LIVE_OWNER_ACK_REQUIRED");

  if (process.env.GAMEVORTEX_LIVE_TRADING_ENABLED !== "true") throw new Error("GAMEVORTEX_LIVE_TRADING_DISABLED");

  const direct = isLiveDirectFundingEnabled();
  if (direct) {
    throw new Error("LIVE_DIRECT_FUNDING_DISABLED");
  }

  // 1. Emergency stop / circuit breaker.
  const { control } = await getTradingControl(input.ownerId);
  const blockers = controlBlockReasons(control);
  if (blockers.length > 0) throw new Error(`TRADING_CONTROL_BLOCKED:${blockers.join(",")}`);

  // 2. Funding source. Wallet mode needs an exact, unbound ACTIVE allocation.
  if (!direct) {
    if (!Number.isInteger(amountUsd)) throw new Error("LIVE_WALLET_MODE_REQUIRES_WHOLE_USD");
    const account = await db.tradingAccount.findUnique({ where: { ownerId: input.ownerId } });
    const allocations = account
      ? await db.tradingAllocation.count({
          where: { accountId: account.id, status: "ACTIVE", relatedTradeId: null, amountUsd },
        })
      : 0;
    if (allocations === 0) throw new Error("TRADING_ALLOCATION_REQUIRED");
  }

  // 3. Fresh market data (public host, no key needed).
  const market = await fetchPublicKlines({ symbol, interval: "5m", limit: 60 });
  const snapshot = buildMarketSnapshot(market.candles);

  // 4. Risk Manager, with the snapshot computed from the live-order table.
  const riskConfig = await getRiskConfig(input.ownerId);
  if (!riskConfig || !riskConfig.enabled) throw new Error("LIVE_RISK_CONFIG_REQUIRED");
  const riskSnapshot = buildLiveRiskSnapshot(await loadOrdersForRisk(input.ownerId), {
    symbol,
    requestedAmountUsd: amountUsd,
    hasStopLoss: true,
    hasTakeProfit: true,
    now: new Date(),
  });
  const risk = evaluateRisk(riskConfig.config, riskSnapshot);
  if (!risk.allowed) throw new Error(`LIVE_RISK_BLOCKED:${risk.reasons.join(",")}`);

  // 5. Shariah (owner spot policy). The owner states that this is a real spot
  //    purchase with immediate delivery of the asset.
  const shariahAsset = {
    symbol,
    assetType: "DIGITAL_ASSET",
    businessActivity: "spot digital asset",
    tradingMethod: "SPOT" as const,
    ownershipSettlementVerified: true,
    source: "OWNER_SELF_REVIEW",
  };
  const shariah = await checkAndRecordShariah({ actorUserId: input.ownerId, asset: shariahAsset });
  if (shariah.decision.status !== "APPROVED") {
    throw new Error(`LIVE_SHARIAH_BLOCKED:${shariah.decision.reasons.join(",")}`);
  }

  // 6. Exchange minimum order size and available quote balance.
  await assertBinanceLiveBuyRules({ symbol, amountUsd, entryPrice: snapshot.price });
  const quoteFreeBalanceUsd = await fetchUsdtFreeBalance();
  if (quoteFreeBalanceUsd < amountUsd) throw new Error("BINANCE_LIVE_INSUFFICIENT_BALANCE");

  // 7. Short-lived owner approval. The BUY still needs consume + typed phrase.
  const opportunityId = `manual-${randomUUID()}`;
  const executionSnapshot: OwnerExecutionSnapshot = {
    symbol,
    price: snapshot.price,
    previousPrice: snapshot.previousPrice,
    fastAverage: snapshot.fastAverage,
    slowAverage: snapshot.slowAverage,
    volume: snapshot.volume,
    averageVolume: snapshot.averageVolume,
    stopLossPercent,
    takeProfitPercent,
    shariah: shariahAsset as unknown as Prisma.JsonObject,
  };

  const { approval, token } = await createOwnerApproval({
    ownerId: input.ownerId,
    opportunityId,
    amountUsd,
    shariahStatus: "APPROVED",
    strategyVersion: STRATEGY_VERSION,
    riskSnapshot: riskSnapshot as unknown as Prisma.JsonObject,
    executionSnapshot,
    ttlSeconds: APPROVAL_TTL_SECONDS,
  });

  return {
    approvalId: approval.id,
    opportunityId,
    token: token.token,
    expiresAt: approval.expiresAt.toISOString(),
    fundingMode: direct ? "DIRECT" : "WALLET",
    summary: {
      symbol,
      amountUsd,
      entryPrice: snapshot.price,
      stopLossPercent,
      takeProfitPercent,
      stopLossPrice: snapshot.price * (1 - stopLossPercent / 100),
      takeProfitPrice: snapshot.price * (1 + takeProfitPercent / 100),
      quoteFreeBalanceUsd,
    },
  };
}
