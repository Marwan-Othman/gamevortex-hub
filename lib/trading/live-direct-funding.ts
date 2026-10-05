/**
 * GameVortex AI Trading — "direct funding" mode for live orders.
 *
 * By default a live order is backed by an Owner Wallet allocation and its
 * result is credited back to the wallet ledger. That needs wallet points,
 * which come from platform revenue.
 *
 * Direct funding is an explicit, opt-in alternative for the account owner
 * trading their OWN balance that already sits on Binance. It is enabled only
 * when GAMEVORTEX_LIVE_DIRECT_FUNDING is exactly "true".
 *
 * What changes in this mode:
 *  - no allocation is bound to the order,
 *  - when the protected exit has closed on the exchange, the order is marked
 *    SETTLED WITHOUT touching OwnerWallet / TradingAccount / any ledger,
 *  - an unfilled order has nothing to release.
 *
 * What does NOT change: Shariah check, Risk Manager, emergency stop and
 * circuit breaker, per-trade owner approval + typed confirmation, Binance
 * preflight, slippage guard, min-notional check, and the protective OCO exit.
 *
 * The realized P/L is still recorded on the order row and in the audit log.
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/prisma";
import type { LiveOrderRow } from "@/lib/trading/live-order-state";
import type { LiveWalletSettlementResult } from "@/lib/trading/live-wallet-settlement";

type DirectSettlementRow = LiveOrderRow & {
  settlementStatus: "NOT_SETTLED" | "EXCHANGE_CLOSED_PENDING_WALLET" | "SETTLED" | "BLOCKED";
  realizedPnlUsd: Prisma.Decimal | null;
};

export function isLiveDirectFundingEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.GAMEVORTEX_LIVE_DIRECT_FUNDING === "true";
}

/**
 * Mark an exchange-closed order as settled without moving any wallet funds.
 * Same result shape as the wallet settlement so the executor can treat both
 * paths identically.
 */
export async function settleClosedLiveOrderDirect(input: {
  ownerId: string;
  order: LiveOrderRow;
}): Promise<LiveWalletSettlementResult> {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<DirectSettlementRow[]>(Prisma.sql`
      SELECT * FROM "TradingLiveOrder" WHERE "id" = ${input.order.id} FOR UPDATE
    `);
    const order = rows[0];
    if (!order) throw new Error("LIVE_ORDER_NOT_FOUND_FOR_DIRECT_SETTLEMENT");

    const blocked = (reason: string): LiveWalletSettlementResult => ({
      order,
      status: "BLOCKED",
      settledUsd: null,
      settledPoints: null,
      roundingUsd: null,
      blockers: [reason],
    });

    if (order.ownerId !== input.ownerId) return blocked("SETTLEMENT_OWNER_MISMATCH");

    if (order.settlementStatus === "SETTLED") {
      return { order, status: "ALREADY_SETTLED", settledUsd: null, settledPoints: null, roundingUsd: null, blockers: [] };
    }

    if (order.status !== "CLOSED" || order.settlementStatus !== "EXCHANGE_CLOSED_PENDING_WALLET") {
      return blocked("LIVE_ORDER_NOT_READY_FOR_DIRECT_SETTLEMENT");
    }

    // A wallet allocation bound to this order means it must settle through
    // the wallet path; never mix the two accounting models on one order.
    const allocation = await tx.tradingAllocation.findFirst({ where: { relatedTradeId: order.id } });
    if (allocation) return blocked("DIRECT_FUNDING_ORDER_HAS_ALLOCATION");

    const updatedRows = await tx.$queryRaw<DirectSettlementRow[]>(Prisma.sql`
      UPDATE "TradingLiveOrder"
      SET "settlementStatus" = 'SETTLED', "settlementError" = NULL, "version" = "version" + 1
      WHERE "id" = ${order.id} AND "status" = 'CLOSED' AND "settlementStatus" = 'EXCHANGE_CLOSED_PENDING_WALLET'
      RETURNING *
    `);
    const updated = updatedRows[0];
    if (!updated) throw new Error("LIVE_DIRECT_SETTLEMENT_STATE_CONFLICT");

    await tx.auditLog.create({
      data: {
        actorUserId: input.ownerId,
        action: "TRADING_LIVE_DIRECT_SETTLED",
        entityType: "TradingLiveOrder",
        entityId: order.id,
        metadata: {
          fundingMode: "DIRECT",
          walletMovement: false,
          realizedPnlUsd: order.realizedPnlUsd?.toString() ?? null,
          amountUsd: order.amountUsd.toString(),
        },
      },
    });

    return { order: updated, status: "SETTLED", settledUsd: null, settledPoints: null, roundingUsd: null, blockers: [] };
  });
}

/**
 * Direct-mode counterpart of releaseUnfilledLiveAllocation: there is no
 * allocation to give back. It still refuses to treat an order that actually
 * executed some quantity as "unfilled".
 */
export async function releaseUnfilledLiveOrderDirect(input: {
  ownerId: string;
  order: LiveOrderRow;
}): Promise<{ order: LiveOrderRow; released: boolean }> {
  const { order } = input;
  if (order.ownerId !== input.ownerId) throw new Error("LIVE_ORDER_OWNER_MISMATCH");

  const executed = order.executedQty ? new Prisma.Decimal(order.executedQty) : new Prisma.Decimal(0);
  const quote = order.cumulativeQuoteQty ? new Prisma.Decimal(order.cumulativeQuoteQty) : new Prisma.Decimal(0);
  if (executed.gt(0) || quote.gt(0)) throw new Error("LIVE_UNFILLED_RELEASE_HAS_EXECUTED_CAPITAL");

  return { order, released: true };
}
