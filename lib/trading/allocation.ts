import { Prisma } from "@prisma/client";
import { db } from "../prisma";
import { OWNER_POINTS_PER_USD } from "../owner-points";
import { allocationPoints, validateAllocationUsd } from "./money";

type Tx = Prisma.TransactionClient;

/**
 * Lock the TradingAccount row so balanceBefore/After are computed against a
 * consistent value even with concurrent requests.
 */
async function lockedAccount(tx: Tx, ownerId: string) {
  const account = await tx.tradingAccount.upsert({
    where: { ownerId },
    create: { ownerId },
    update: {},
  });

  await tx.$queryRaw`SELECT "id" FROM "TradingAccount" WHERE "id" = ${account.id} FOR UPDATE`;

  return tx.tradingAccount.findUniqueOrThrow({ where: { id: account.id } });
}

/**
 * Owner Wallet (points) -> Trading Balance (USD).
 * Idempotent on `idempotencyKey`; the same key with different data is rejected.
 */
export async function createAllocation(input: {
  ownerId: string;
  amountUsd: unknown;
  idempotencyKey: string;
}) {
  const amountUsd = validateAllocationUsd(input.amountUsd);
  const points = allocationPoints(amountUsd, OWNER_POINTS_PER_USD);
  const key = input.idempotencyKey;

  return db.$transaction(async (tx) => {
    // The wallet row is normally created by the first payment credit. Creating
    // it here is harmless (0 points) and gives the owner the accurate
    // INSUFFICIENT_POINTS error instead of "wallet not found".
    const wallet = await tx.ownerWallet.upsert({
      where: { ownerId: input.ownerId },
      update: {},
      create: { ownerId: input.ownerId },
    });

    const existing = await tx.tradingAllocation.findUnique({ where: { idempotencyKey: key } });
    if (existing) {
      if (existing.sourceWalletId !== wallet.id || existing.amountUsd !== amountUsd) {
        throw new Error("IDEMPOTENCY_KEY_CONFLICT");
      }
      return { allocation: existing, replayed: true };
    }

    const account = await lockedAccount(tx, input.ownerId);

    // Atomic guard: fails if another request already spent these points.
    const debited = await tx.ownerWallet.updateMany({
      where: { id: wallet.id, availablePoints: { gte: points } },
      data: { availablePoints: { decrement: points } },
    });
    if (debited.count !== 1) throw new Error("INSUFFICIENT_POINTS");

    const allocation = await tx.tradingAllocation.create({
      data: {
        accountId: account.id,
        sourceWalletId: wallet.id,
        amountUsd,
        points,
        conversionRate: OWNER_POINTS_PER_USD,
        idempotencyKey: key,
      },
    });

    const before = account.balanceUsd;
    const after = before.add(amountUsd);

    await tx.tradingAccount.update({ where: { id: account.id }, data: { balanceUsd: after } });

    await tx.ownerLedger.create({
      data: {
        walletId: wallet.id,
        type: "TRADING_ALLOCATED",
        points: -points,
        usdAmount: amountUsd,
        conversionRate: OWNER_POINTS_PER_USD,
        idempotencyKey: `${key}:owner`,
        metadata: { allocationId: allocation.id },
      },
    });

    await tx.tradingLedger.create({
      data: {
        accountId: account.id,
        allocationId: allocation.id,
        type: "ALLOCATION_IN",
        amountUsd,
        balanceBeforeUsd: before,
        balanceAfterUsd: after,
        idempotencyKey: `${key}:trading`,
        metadata: { sourceWalletId: wallet.id, points },
      },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: input.ownerId,
        action: "TRADING_ALLOCATION_CREATED",
        entityType: "TradingAllocation",
        entityId: allocation.id,
        metadata: { amountUsd, points, conversionRate: OWNER_POINTS_PER_USD },
      },
    });

    return { allocation, replayed: false };
  });
}

/**
 * Trading Balance (USD) -> Owner Wallet (points). Returns the unused capital.
 * Uses the points stored on the allocation, so the return is exactly what was taken.
 * An allocation linked to a trade can't be released (double-spend protection).
 */
export async function releaseAllocation(input: { ownerId: string; allocationId: string }) {
  return db.$transaction(async (tx) => {
    const account = await lockedAccount(tx, input.ownerId);

    const allocation = await tx.tradingAllocation.findFirst({
      where: { id: input.allocationId, accountId: account.id },
    });
    if (!allocation) throw new Error("ALLOCATION_NOT_FOUND");

    if (allocation.status === "RELEASED") throw new Error("ALLOCATION_ALREADY_RELEASED");
    if (allocation.relatedTradeId) throw new Error("ALLOCATION_IN_USE");

    if (account.balanceUsd.lt(allocation.amountUsd)) {
      throw new Error("INSUFFICIENT_TRADING_BALANCE");
    }

    // Flip status only if still ACTIVE: two parallel releases can't both win.
    const flipped = await tx.tradingAllocation.updateMany({
      where: { id: allocation.id, status: "ACTIVE", relatedTradeId: null },
      data: { status: "RELEASED", releasedAt: new Date() },
    });
    if (flipped.count !== 1) throw new Error("ALLOCATION_ALREADY_RELEASED");

    const before = account.balanceUsd;
    const after = before.sub(allocation.amountUsd);

    await tx.tradingAccount.update({ where: { id: account.id }, data: { balanceUsd: after } });

    await tx.ownerWallet.update({
      where: { id: allocation.sourceWalletId },
      data: { availablePoints: { increment: allocation.points } },
    });

    await tx.ownerLedger.create({
      data: {
        walletId: allocation.sourceWalletId,
        type: "TRADING_RETURNED",
        points: allocation.points,
        usdAmount: allocation.amountUsd,
        conversionRate: allocation.conversionRate,
        idempotencyKey: `${allocation.idempotencyKey}:owner-return`,
        metadata: { allocationId: allocation.id },
      },
    });

    await tx.tradingLedger.create({
      data: {
        accountId: account.id,
        allocationId: allocation.id,
        type: "ALLOCATION_RETURN",
        amountUsd: allocation.amountUsd,
        balanceBeforeUsd: before,
        balanceAfterUsd: after,
        idempotencyKey: `${allocation.idempotencyKey}:trading-return`,
        metadata: { points: allocation.points },
      },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: input.ownerId,
        action: "TRADING_ALLOCATION_RELEASED",
        entityType: "TradingAllocation",
        entityId: allocation.id,
        metadata: { amountUsd: allocation.amountUsd, points: allocation.points },
      },
    });

    return { allocationId: allocation.id, amountUsd: allocation.amountUsd, points: allocation.points };
  });
}

export async function getTradingSummary(ownerId: string) {
  const [account, wallet] = await Promise.all([
    db.tradingAccount.findUnique({ where: { ownerId } }),
    db.ownerWallet.findUnique({ where: { ownerId } }),
  ]);

  const allocations = account
    ? await db.tradingAllocation.findMany({
        where: { accountId: account.id },
        orderBy: { createdAt: "desc" },
        take: 50,
      })
    : [];

  return {
    walletAvailablePoints: wallet?.availablePoints ?? 0,
    pointsPerUsd: OWNER_POINTS_PER_USD,
    walletAvailableUsd: wallet ? Number((wallet.availablePoints / OWNER_POINTS_PER_USD).toFixed(2)) : 0,
    tradingBalanceUsd: account ? account.balanceUsd.toString() : "0",
    allocations: allocations.map((a) => ({
      id: a.id,
      amountUsd: a.amountUsd,
      points: a.points,
      status: a.status,
      relatedTradeId: a.relatedTradeId,
      createdAt: a.createdAt.toISOString(),
      releasedAt: a.releasedAt?.toISOString() ?? null,
    })),
  };
}
