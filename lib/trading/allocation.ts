import { Prisma } from "@prisma/client";
import { db } from "../prisma";
import { OWNER_POINTS_PER_USD } from "../owner-points";
import { validateAllocationUsd } from "./money";

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
 * Lock the owner's real USD wallet before changing its balance.
 * Trading capital is cash and must never be represented by owner points.
 */
async function lockedOwnerWallet(tx: Tx, ownerId: string) {
  const wallet = await tx.wallet.upsert({
    where: { userId: ownerId },
    create: { userId: ownerId },
    update: {},
  });

  await tx.$queryRaw`SELECT "id" FROM "Wallet" WHERE "id" = ${wallet.id} FOR UPDATE`;

  return tx.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
}

/**
 * Owner USD Wallet -> Trading Balance (USD).
 *
 * IMPORTANT:
 * - Owner points are NOT used as trading capital.
 * - The Wallet.balance is the financial source of truth.
 * - TradingAllocation.sourceWalletId is retained for schema compatibility with
 *   the existing OwnerWallet relation; it is not used as the funding balance.
 * - WalletTransaction is the financial movement record.
 * - TradingLedger is the trading-account movement record.
 * - The operation is idempotent on idempotencyKey.
 */
export async function createAllocation(input: {
  ownerId: string;
  amountUsd: unknown;
  idempotencyKey: string;
}) {
  const amountUsd = validateAllocationUsd(input.amountUsd);
  const key = input.idempotencyKey;

  return db.$transaction(async (tx) => {
    const wallet = await lockedOwnerWallet(tx, input.ownerId);

    const ownerWallet = await tx.ownerWallet.upsert({
      where: { ownerId: input.ownerId },
      update: {},
      create: { ownerId: input.ownerId },
    });

    const existing = await tx.tradingAllocation.findUnique({ where: { idempotencyKey: key } });
    if (existing) {
      if (existing.sourceWalletId !== ownerWallet.id || existing.amountUsd !== amountUsd) {
        throw new Error("IDEMPOTENCY_KEY_CONFLICT");
      }
      return { allocation: existing, replayed: true };
    }

    const account = await lockedAccount(tx, input.ownerId);

    // Atomic guard: the wallet row is locked and the update still checks the
    // balance so insufficient funds can never produce a negative balance.
    const debited = await tx.wallet.updateMany({
      where: { id: wallet.id, balance: { gte: new Prisma.Decimal(amountUsd) } },
      data: { balance: { decrement: new Prisma.Decimal(amountUsd) } },
    });
    if (debited.count !== 1) throw new Error("INSUFFICIENT_WALLET_BALANCE");

    const balanceBefore = wallet.balance;
    const balanceAfter = balanceBefore.sub(new Prisma.Decimal(amountUsd));

    const allocation = await tx.tradingAllocation.create({
      data: {
        accountId: account.id,
        sourceWalletId: ownerWallet.id,
        amountUsd,
        // Legacy compatibility fields. New allocations are funded by USD,
        // not by points. They remain until the schema cleanup migration.
        points: 0,
        conversionRate: OWNER_POINTS_PER_USD,
        idempotencyKey: key,
      },
    });

    const tradingBefore = account.balanceUsd;
    const tradingAfter = tradingBefore.add(new Prisma.Decimal(amountUsd));

    await tx.tradingAccount.update({
      where: { id: account.id },
      data: { balanceUsd: tradingAfter },
    });

    await tx.walletTransaction.create({
      data: {
        userId: input.ownerId,
        walletId: wallet.id,
        type: "ADJUSTMENT",
        amount: new Prisma.Decimal(amountUsd).neg(),
        balanceBefore,
        balanceAfter,
        currency: "USD",
        referenceType: "TRADING_ALLOCATION",
        referenceId: allocation.id,
        idempotencyKey: `${key}:wallet`,
        metadata: {
          allocationId: allocation.id,
          direction: "OUT",
          reason: "Trading capital allocation",
        },
      },
    });

    await tx.tradingLedger.create({
      data: {
        accountId: account.id,
        allocationId: allocation.id,
        type: "ALLOCATION_IN",
        amountUsd,
        balanceBeforeUsd: tradingBefore,
        balanceAfterUsd: tradingAfter,
        idempotencyKey: `${key}:trading`,
        metadata: {
          sourceWalletId: wallet.id,
          source: "USER_WALLET_USD",
        },
      },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: input.ownerId,
        action: "TRADING_ALLOCATION_CREATED",
        entityType: "TradingAllocation",
        entityId: allocation.id,
        metadata: {
          amountUsd,
          source: "USER_WALLET_USD",
          walletId: wallet.id,
        },
      },
    });

    return { allocation, replayed: false };
  });
}

/**
 * Trading Balance (USD) -> Owner USD Wallet.
 * Returns unused capital without touching owner points.
 */
export async function releaseAllocation(input: { ownerId: string; allocationId: string }) {
  return db.$transaction(async (tx) => {
    const wallet = await lockedOwnerWallet(tx, input.ownerId);
    const account = await lockedAccount(tx, input.ownerId);

    const allocation = await tx.tradingAllocation.findFirst({
      where: { id: input.allocationId, accountId: account.id },
    });
    if (!allocation) throw new Error("ALLOCATION_NOT_FOUND");

    if (allocation.status === "RELEASED") throw new Error("ALLOCATION_ALREADY_RELEASED");
    if (allocation.relatedTradeId) throw new Error("ALLOCATION_IN_USE");

    if (account.balanceUsd.lt(new Prisma.Decimal(allocation.amountUsd))) {
      throw new Error("INSUFFICIENT_TRADING_BALANCE");
    }

    const flipped = await tx.tradingAllocation.updateMany({
      where: { id: allocation.id, status: "ACTIVE", relatedTradeId: null },
      data: { status: "RELEASED", releasedAt: new Date() },
    });
    if (flipped.count !== 1) throw new Error("ALLOCATION_ALREADY_RELEASED");

    const tradingBefore = account.balanceUsd;
    const tradingAfter = tradingBefore.sub(new Prisma.Decimal(allocation.amountUsd));

    await tx.tradingAccount.update({
      where: { id: account.id },
      data: { balanceUsd: tradingAfter },
    });

    const walletBefore = wallet.balance;
    const walletAfter = walletBefore.add(new Prisma.Decimal(allocation.amountUsd));

    await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: walletAfter },
    });

    await tx.walletTransaction.create({
      data: {
        userId: input.ownerId,
        walletId: wallet.id,
        type: "ADJUSTMENT",
        amount: new Prisma.Decimal(allocation.amountUsd),
        balanceBefore: walletBefore,
        balanceAfter: walletAfter,
        currency: "USD",
        referenceType: "TRADING_ALLOCATION_RETURN",
        referenceId: allocation.id,
        idempotencyKey: `${allocation.idempotencyKey}:wallet-return`,
        metadata: {
          allocationId: allocation.id,
          direction: "IN",
          reason: "Unused trading capital returned",
        },
      },
    });

    await tx.tradingLedger.create({
      data: {
        accountId: account.id,
        allocationId: allocation.id,
        type: "ALLOCATION_RETURN",
        amountUsd: allocation.amountUsd,
        balanceBeforeUsd: tradingBefore,
        balanceAfterUsd: tradingAfter,
        idempotencyKey: `${allocation.idempotencyKey}:trading-return`,
        metadata: { source: "USER_WALLET_USD" },
      },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: input.ownerId,
        action: "TRADING_ALLOCATION_RELEASED",
        entityType: "TradingAllocation",
        entityId: allocation.id,
        metadata: {
          amountUsd: allocation.amountUsd,
          destination: "USER_WALLET_USD",
          walletId: wallet.id,
        },
      },
    });

    return {
      allocationId: allocation.id,
      amountUsd: allocation.amountUsd,
      returnedToWallet: true,
    };
  });
}

export async function getTradingSummary(ownerId: string) {
  const [account, wallet, ownerWallet] = await Promise.all([
    db.tradingAccount.findUnique({ where: { ownerId } }),
    db.wallet.findUnique({ where: { userId: ownerId } }),
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
    // Kept for compatibility with the existing admin UI; points are no longer
    // used to fund trading.
    walletAvailablePoints: ownerWallet?.availablePoints ?? 0,
    pointsPerUsd: OWNER_POINTS_PER_USD,
    walletAvailableUsd: wallet?.balance.toString() ?? "0",
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
