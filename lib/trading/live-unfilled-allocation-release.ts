import { Prisma } from "@prisma/client";
import { db } from "@/lib/prisma";
import { OWNER_POINTS_PER_USD } from "@/lib/owner-points";
import type { LiveOrderRow } from "@/lib/trading/live-order-state";

export async function releaseUnfilledLiveAllocation(input: {
  ownerId: string;
  order: LiveOrderRow;
}): Promise<{ order: LiveOrderRow; released: boolean }> {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<LiveOrderRow[]>(Prisma.sql`
      SELECT * FROM "TradingLiveOrder" WHERE "id" = ${input.order.id} FOR UPDATE
    `);
    const order = rows[0];
    if (!order) throw new Error("LIVE_ORDER_NOT_FOUND_FOR_ALLOCATION_RELEASE");
    if (order.ownerId !== input.ownerId) throw new Error("LIVE_ORDER_OWNER_MISMATCH");

    if (order.settlementStatus === "SETTLED") return { order, released: false };

    const executedQty = order.executedQty ? new Prisma.Decimal(order.executedQty) : new Prisma.Decimal(0);
    const quoteQty = order.cumulativeQuoteQty ? new Prisma.Decimal(order.cumulativeQuoteQty) : new Prisma.Decimal(0);
    if (executedQty.gt(0) || quoteQty.gt(0)) {
      throw new Error("LIVE_UNFILLED_RELEASE_HAS_EXECUTED_CAPITAL");
    }

    const allocation = await tx.tradingAllocation.findFirst({
      where: { relatedTradeId: order.id, status: "ACTIVE" },
    });
    if (!allocation) return { order, released: false };

    const account = await tx.tradingAccount.findUniqueOrThrow({ where: { id: allocation.accountId } });
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "TradingAccount" WHERE "id" = ${account.id} FOR UPDATE
    `);
    const lockedAccount = await tx.tradingAccount.findUniqueOrThrow({ where: { id: account.id } });

    if (lockedAccount.balanceUsd.lt(new Prisma.Decimal(allocation.amountUsd))) {
      throw new Error("INSUFFICIENT_TRADING_BALANCE_FOR_UNFILLED_RELEASE");
    }

    const wallet = await tx.ownerWallet.findUniqueOrThrow({ where: { id: allocation.sourceWalletId } });
    if (wallet.ownerId !== input.ownerId) throw new Error("SETTLEMENT_SOURCE_WALLET_MISMATCH");
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "OwnerWallet" WHERE "id" = ${wallet.id} FOR UPDATE
    `);

    const released = await tx.tradingAllocation.updateMany({
      where: { id: allocation.id, status: "ACTIVE", relatedTradeId: order.id },
      data: { status: "RELEASED", releasedAt: new Date() },
    });
    if (released.count !== 1) throw new Error("TRADING_ALLOCATION_RELEASE_CONFLICT");

    const beforeBalance = lockedAccount.balanceUsd;
    const afterBalance = beforeBalance.sub(new Prisma.Decimal(allocation.amountUsd));

    await tx.tradingAccount.update({
      where: { id: lockedAccount.id },
      data: { balanceUsd: afterBalance },
    });

    await tx.ownerWallet.update({
      where: { id: wallet.id },
      data: { availablePoints: { increment: allocation.points } },
    });

    const baseKey = `live-unfilled-release:${order.id}`;
    await tx.ownerLedger.create({
      data: {
        walletId: wallet.id,
        type: "TRADING_RETURNED",
        points: allocation.points,
        usdAmount: allocation.amountUsd,
        conversionRate: OWNER_POINTS_PER_USD,
        idempotencyKey: `${baseKey}:owner`,
        metadata: { liveOrderId: order.id, allocationId: allocation.id, reason: "NO_FILL" },
      },
    });

    await tx.tradingLedger.create({
      data: {
        accountId: lockedAccount.id,
        allocationId: allocation.id,
        type: "ALLOCATION_RETURN",
        amountUsd: allocation.amountUsd,
        balanceBeforeUsd: beforeBalance,
        balanceAfterUsd: afterBalance,
        relatedTradeId: order.id,
        idempotencyKey: `${baseKey}:trading`,
        metadata: { liveOrderId: order.id, allocationId: allocation.id, reason: "NO_FILL" },
      },
    });

    const updatedRows = await tx.$queryRaw<LiveOrderRow[]>(Prisma.sql`
      UPDATE "TradingLiveOrder"
      SET
        "settlementStatus" = 'SETTLED',
        "walletSettledAt" = CURRENT_TIMESTAMP,
        "settledUsd" = ${allocation.amountUsd}::numeric,
        "settledPoints" = ${allocation.points},
        "settlementRoundingUsd" = 0::numeric,
        "settlementError" = NULL,
        "version" = "version" + 1
      WHERE "id" = ${order.id}
        AND "settlementStatus" <> 'SETTLED'
      RETURNING *
    `;

    const updated = updatedRows[0];
    if (!updated) throw new Error("LIVE_UNFILLED_RELEASE_STATE_CONFLICT");

    await tx.auditLog.create({
      data: {
        actorUserId: input.ownerId,
        action: "TRADING_LIVE_UNFILLED_ALLOCATION_RELEASED",
        entityType: "TradingLiveOrder",
        entityId: order.id,
        metadata: { allocationId: allocation.id, amountUsd: allocation.amountUsd, points: allocation.points },
      },
    });

    return { order: updated, released: true };
  });
}
