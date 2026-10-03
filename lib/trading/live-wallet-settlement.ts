import { Prisma } from "@prisma/client";
import { db } from "@/lib/prisma";
import { OWNER_POINTS_PER_USD } from "@/lib/owner-points";
import type { LiveOrderRow } from "@/lib/trading/live-order-state";

export type LiveWalletSettlementStatus = "SETTLED" | "BLOCKED" | "ALREADY_SETTLED";

type LiveOrderSettlementRow = LiveOrderRow & {
  settlementStatus: "NOT_SETTLED" | "EXCHANGE_CLOSED_PENDING_WALLET" | "SETTLED" | "BLOCKED";
  exitCumulativeQuoteQty: Prisma.Decimal | null;
  realizedPnlUsd: Prisma.Decimal | null;
  settledUsd: Prisma.Decimal | null;
  settledPoints: number | null;
  settlementRoundingUsd: Prisma.Decimal | null;
};

export type LiveWalletSettlementResult = {
  order: LiveOrderRow;
  status: LiveWalletSettlementStatus;
  settledUsd: string | null;
  settledPoints: number | null;
  roundingUsd: string | null;
  blockers: string[];
};

export type OwnerWalletSettlementCalculation = {
  returnedUsd: Prisma.Decimal;
  settledUsd: Prisma.Decimal;
  settledPoints: number;
  roundingUsd: Prisma.Decimal;
};

export function calculateOwnerWalletSettlement(
  returnedUsdInput: Prisma.Decimal | string | number,
): OwnerWalletSettlementCalculation {
  const returnedUsd =
    returnedUsdInput instanceof Prisma.Decimal
      ? returnedUsdInput
      : new Prisma.Decimal(returnedUsdInput);

  if (!returnedUsd.isFinite() || returnedUsd.lessThan(0)) {
    throw new Error("INVALID_SETTLEMENT_PROCEEDS");
  }

  if (!Number.isSafeInteger(OWNER_POINTS_PER_USD) || OWNER_POINTS_PER_USD <= 0) {
    throw new Error("INVALID_OWNER_POINTS_RATE");
  }

  const rawPoints = returnedUsd.mul(OWNER_POINTS_PER_USD).floor();
  if (!rawPoints.isInteger() || (!rawPoints.isPositive() && !rawPoints.isZero())) {
    throw new Error("INVALID_SETTLEMENT_POINTS");
  }

  const settledPoints = rawPoints.toNumber();
  if (!Number.isSafeInteger(settledPoints) || settledPoints < 0) {
    throw new Error("SETTLEMENT_POINTS_OVERFLOW");
  }

  const settledUsd = new Prisma.Decimal(settledPoints).div(OWNER_POINTS_PER_USD);
  const roundingUsd = returnedUsd.sub(settledUsd);
  if (roundingUsd.isNegative()) throw new Error("NEGATIVE_SETTLEMENT_ROUNDING");

  return { returnedUsd, settledUsd, settledPoints, roundingUsd };
}

async function blockSettlement(tx: Prisma.TransactionClient, orderId: string, reason: string): Promise<LiveOrderRow> {
  const rows = await tx.$queryRaw<LiveOrderRow[]>(Prisma.sql`
    UPDATE "TradingLiveOrder"
    SET "settlementStatus" = 'BLOCKED', "settlementError" = ${reason.slice(0, 500)}, "version" = "version" + 1
    WHERE "id" = ${orderId}
    RETURNING *
  `);
  if (!rows[0]) throw new Error("LIVE_WALLET_SETTLEMENT_BLOCK_UPDATE_FAILED");
  return rows[0];
}

export async function settleClosedLiveOrderToOwnerWallet(input: {
  ownerId: string;
  order: LiveOrderRow;
}): Promise<LiveWalletSettlementResult> {
  return db.$transaction(async (tx) => {
    const lockedRows = await tx.$queryRaw<LiveOrderSettlementRow[]>(Prisma.sql`
      SELECT * FROM "TradingLiveOrder" WHERE "id" = ${input.order.id} FOR UPDATE
    `);
    const order = lockedRows[0];
    if (!order) throw new Error("LIVE_ORDER_NOT_FOUND_FOR_WALLET_SETTLEMENT");

    if (order.ownerId !== input.ownerId) {
      const blocked = await blockSettlement(tx, order.id, "SETTLEMENT_OWNER_MISMATCH");
      return { order: blocked, status: "BLOCKED", settledUsd: null, settledPoints: null, roundingUsd: null, blockers: ["SETTLEMENT_OWNER_MISMATCH"] };
    }

    if (order.settlementStatus === "SETTLED") {
      return {
        order,
        status: "ALREADY_SETTLED",
        settledUsd: order.settledUsd?.toString() ?? null,
        settledPoints: order.settledPoints ?? null,
        roundingUsd: order.settlementRoundingUsd?.toString() ?? null,
        blockers: [],
      };
    }

    if (order.status !== "CLOSED" || order.settlementStatus !== "EXCHANGE_CLOSED_PENDING_WALLET") {
      const blocked = await blockSettlement(tx, order.id, "LIVE_ORDER_NOT_READY_FOR_WALLET_SETTLEMENT");
      return { order: blocked, status: "BLOCKED", settledUsd: null, settledPoints: null, roundingUsd: null, blockers: ["LIVE_ORDER_NOT_READY_FOR_WALLET_SETTLEMENT"] };
    }

    if (!order.exitCumulativeQuoteQty) {
      const blocked = await blockSettlement(tx, order.id, "SETTLEMENT_EXIT_PROCEEDS_REQUIRED");
      return { order: blocked, status: "BLOCKED", settledUsd: null, settledPoints: null, roundingUsd: null, blockers: ["SETTLEMENT_EXIT_PROCEEDS_REQUIRED"] };
    }

    const allocation = await tx.tradingAllocation.findFirst({ where: { relatedTradeId: order.id, status: "ACTIVE" } });
    if (!allocation) {
      const blocked = await blockSettlement(tx, order.id, "TRADING_ALLOCATION_NOT_BOUND");
      return { order: blocked, status: "BLOCKED", settledUsd: null, settledPoints: null, roundingUsd: null, blockers: ["TRADING_ALLOCATION_NOT_BOUND"] };
    }

    const account = await tx.tradingAccount.findUniqueOrThrow({ where: { ownerId: input.ownerId } });
    if (allocation.accountId !== account.id) {
      const blocked = await blockSettlement(tx, order.id, "TRADING_ALLOCATION_ACCOUNT_MISMATCH");
      return { order: blocked, status: "BLOCKED", settledUsd: null, settledPoints: null, roundingUsd: null, blockers: ["TRADING_ALLOCATION_ACCOUNT_MISMATCH"] };
    }

    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "TradingAccount" WHERE "id" = ${account.id} FOR UPDATE`);
    const lockedAccount = await tx.tradingAccount.findUniqueOrThrow({ where: { id: account.id } });
    if (lockedAccount.balanceUsd.lt(new Prisma.Decimal(allocation.amountUsd))) {
      const blocked = await blockSettlement(tx, order.id, "INSUFFICIENT_TRADING_BALANCE_FOR_SETTLEMENT");
      return { order: blocked, status: "BLOCKED", settledUsd: null, settledPoints: null, roundingUsd: null, blockers: ["INSUFFICIENT_TRADING_BALANCE_FOR_SETTLEMENT"] };
    }

    const wallet = await tx.ownerWallet.findUnique({ where: { id: allocation.sourceWalletId } });
    if (!wallet || wallet.ownerId !== input.ownerId) {
      const blocked = await blockSettlement(tx, order.id, "SETTLEMENT_SOURCE_WALLET_MISMATCH");
      return { order: blocked, status: "BLOCKED", settledUsd: null, settledPoints: null, roundingUsd: null, blockers: ["SETTLEMENT_SOURCE_WALLET_MISMATCH"] };
    }
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "OwnerWallet" WHERE "id" = ${wallet.id} FOR UPDATE`);

    const proceeds = new Prisma.Decimal(order.exitCumulativeQuoteQty);
    const calculation = calculateOwnerWalletSettlement(proceeds);
    const beforeBalance = lockedAccount.balanceUsd;
    const afterBalance = beforeBalance.sub(new Prisma.Decimal(allocation.amountUsd));

    const released = await tx.tradingAllocation.updateMany({
      where: { id: allocation.id, status: "ACTIVE", relatedTradeId: order.id },
      data: { status: "RELEASED", releasedAt: new Date() },
    });
    if (released.count !== 1) throw new Error("TRADING_ALLOCATION_SETTLEMENT_CONFLICT");

    await tx.tradingAccount.update({ where: { id: lockedAccount.id }, data: { balanceUsd: afterBalance } });
    await tx.ownerWallet.update({ where: { id: wallet.id }, data: { availablePoints: { increment: calculation.settledPoints } } });

    const baseKey = `live-settlement:${order.id}`;
    await tx.ownerLedger.create({
      data: {
        walletId: wallet.id,
        type: "TRADING_RETURNED",
        points: calculation.settledPoints,
        usdAmount: calculation.settledUsd,
        conversionRate: OWNER_POINTS_PER_USD,
        idempotencyKey: `${baseKey}:owner`,
        metadata: { liveOrderId: order.id, allocationId: allocation.id, returnedUsd: calculation.returnedUsd.toString(), realizedPnlUsd: order.realizedPnlUsd?.toString() ?? null, roundingUsd: calculation.roundingUsd.toString() },
      },
    });

    await tx.tradingLedger.create({
      data: {
        accountId: lockedAccount.id,
        allocationId: allocation.id,
        type: "ALLOCATION_RETURN",
        amountUsd: calculation.returnedUsd,
        balanceBeforeUsd: beforeBalance,
        balanceAfterUsd: afterBalance,
        relatedTradeId: order.id,
        idempotencyKey: `${baseKey}:trading`,
        metadata: { liveOrderId: order.id, allocationId: allocation.id, settledPoints: calculation.settledPoints, settledUsd: calculation.settledUsd.toString(), roundingUsd: calculation.roundingUsd.toString(), realizedPnlUsd: order.realizedPnlUsd?.toString() ?? null },
      },
    });

    const updatedRows = await tx.$queryRaw<LiveOrderSettlementRow[]>(Prisma.sql`
      UPDATE "TradingLiveOrder"
      SET
        "settlementStatus" = 'SETTLED',
        "walletSettledAt" = CURRENT_TIMESTAMP,
        "settledUsd" = ${calculation.settledUsd.toString()}::numeric,
        "settledPoints" = ${calculation.settledPoints},
        "settlementRoundingUsd" = ${calculation.roundingUsd.toString()}::numeric,
        "settlementError" = NULL,
        "version" = "version" + 1
      WHERE "id" = ${order.id} AND "status" = 'CLOSED' AND "settlementStatus" = 'EXCHANGE_CLOSED_PENDING_WALLET'
      RETURNING *
    `);
    const updated = updatedRows[0];
    if (!updated) throw new Error("LIVE_WALLET_SETTLEMENT_STATE_CONFLICT");

    await tx.auditLog.create({
      data: {
        actorUserId: input.ownerId,
        action: "TRADING_LIVE_WALLET_SETTLED",
        entityType: "TradingLiveOrder",
        entityId: order.id,
        metadata: { allocationId: allocation.id, returnedUsd: calculation.returnedUsd.toString(), settledUsd: calculation.settledUsd.toString(), settledPoints: calculation.settledPoints, roundingUsd: calculation.roundingUsd.toString(), realizedPnlUsd: order.realizedPnlUsd?.toString() ?? null },
      },
    });

    return { order: updated, status: "SETTLED", settledUsd: calculation.settledUsd.toString(), settledPoints: calculation.settledPoints, roundingUsd: calculation.roundingUsd.toString(), blockers: [] };
  });
}
