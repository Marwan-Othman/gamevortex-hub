import { Prisma } from "@prisma/client";
import { db } from "@/lib/prisma";
import type { LiveOrderRow } from "@/lib/trading/live-order-state";

export type LiveAllocationBindingResult = {
  order: LiveOrderRow;
  allocationId: string;
};

/**
 * Bind one existing ACTIVE trading allocation to one live order.
 *
 * A live trade never creates capital implicitly: the owner must have already
 * allocated the approved amount from Owner Wallet -> Trading Account. The
 * binding is deliberately fail-closed when zero or multiple unbound
 * allocations match the order amount.
 */
export async function bindLiveOrderToAllocation(input: {
  ownerId: string;
  order: LiveOrderRow;
}): Promise<LiveAllocationBindingResult> {
  return db.$transaction(async (tx) => {
    const orderRows = await tx.$queryRaw<LiveOrderRow[]>(Prisma.sql`
      SELECT * FROM "TradingLiveOrder"
      WHERE "id" = ${input.order.id}
      FOR UPDATE
    `);
    const order = orderRows[0];
    if (!order) throw new Error("LIVE_ORDER_NOT_FOUND_FOR_ALLOCATION_BINDING");
    if (order.ownerId !== input.ownerId) throw new Error("LIVE_ORDER_OWNER_MISMATCH");

    const existing = await tx.tradingAllocation.findFirst({
      where: { relatedTradeId: order.id },
    });
    if (existing) {
      if (existing.accountId !== (await tx.tradingAccount.findUniqueOrThrow({ where: { ownerId: input.ownerId } })).id) {
        throw new Error("LIVE_ALLOCATION_ACCOUNT_MISMATCH");
      }
      if (existing.amountUsd !== order.amountUsd.toNumber()) {
        throw new Error("LIVE_ALLOCATION_AMOUNT_MISMATCH");
      }
      return { order, allocationId: existing.id };
    }

    const account = await tx.tradingAccount.findUnique({ where: { ownerId: input.ownerId } });
    if (!account) throw new Error("TRADING_ACCOUNT_REQUIRED");

    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "TradingAccount" WHERE "id" = ${account.id} FOR UPDATE
    `);

    const candidates = await tx.tradingAllocation.findMany({
      where: {
        accountId: account.id,
        status: "ACTIVE",
        relatedTradeId: null,
        amountUsd: order.amountUsd.toNumber(),
      },
      orderBy: { createdAt: "asc" },
      take: 2,
    });

    if (candidates.length === 0) throw new Error("TRADING_ALLOCATION_REQUIRED");
    if (candidates.length > 1) throw new Error("TRADING_ALLOCATION_AMBIGUOUS");

    const allocation = candidates[0];
    const bound = await tx.tradingAllocation.updateMany({
      where: {
        id: allocation.id,
        accountId: account.id,
        status: "ACTIVE",
        relatedTradeId: null,
      },
      data: { relatedTradeId: order.id },
    });

    if (bound.count !== 1) throw new Error("TRADING_ALLOCATION_BIND_CONFLICT");

    await tx.auditLog.create({
      data: {
        actorUserId: input.ownerId,
        action: "TRADING_LIVE_ALLOCATION_BOUND",
        entityType: "TradingLiveOrder",
        entityId: order.id,
        metadata: {
          allocationId: allocation.id,
          amountUsd: order.amountUsd.toString(),
        },
      },
    });

    return { order, allocationId: allocation.id };
  });
}
