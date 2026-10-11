import { Prisma } from "@prisma/client";
import { db } from "./prisma";

export type PointLedgerMetadata = Prisma.InputJsonValue;

export type CreditPointsInput = {
  userId: string;
  amount: number;
  reason: string;
  idempotencyKey: string;
  sourceId?: string;
  metadata?: PointLedgerMetadata;
};

export type DebitPointsInput = {
  userId: string;
  amount: number;
  reason: string;
  idempotencyKey: string;
  sourceId?: string;
  metadata?: PointLedgerMetadata;
};

export type AdjustPointsInput = {
  userId: string;
  amount: number;
  reason: string;
  idempotencyKey: string;
  sourceId?: string;
  metadata?: PointLedgerMetadata;
};

export const USER_POINTS_PER_USD = 1_000;
export const VIP_POINTS_PER_USD = 500;
export const STORE_PURCHASE_POINTS_PER_USD = 10;

export function pointsToValueCents(points: number, isVip = false) {
  if (!Number.isSafeInteger(points) || points < 0) throw new Error("INVALID_POINTS");
  const rate = isVip ? VIP_POINTS_PER_USD : USER_POINTS_PER_USD;
  return Math.floor(points * 100 / rate);
}

export function calculateStorePurchasePoints(amountCents: number, currency: string) {
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) throw new Error("INVALID_PURCHASE_AMOUNT");
  if (currency.toUpperCase() !== "USD") return 0;
  return Math.floor(amountCents * STORE_PURCHASE_POINTS_PER_USD / 100);
}

export function calculateProductRewardPoints(
  items: Array<{
    quantity: number;
    unitPriceCents: number;
    currency: string;
    rewardPoints?: number | null;
  }>,
) {
  return items.reduce((total, item) => {
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
      throw new Error("INVALID_PRODUCT_QUANTITY");
    }
    if (!Number.isSafeInteger(item.unitPriceCents) || item.unitPriceCents < 0) {
      throw new Error("INVALID_PURCHASE_AMOUNT");
    }

    const points = item.rewardPoints == null
      ? calculateStorePurchasePoints(item.unitPriceCents * item.quantity, item.currency)
      : Number.isSafeInteger(item.rewardPoints) && item.rewardPoints >= 0
        ? item.rewardPoints * item.quantity
        : (() => { throw new Error("INVALID_PRODUCT_REWARD_POINTS"); })();

    const result = total + points;
    if (!Number.isSafeInteger(result)) throw new Error("INVALID_PRODUCT_REWARD_POINTS");
    return result;
  }, 0);
}

export async function reversePointsInTransaction(
  transaction: Prisma.TransactionClient,
  input: { userId: string; amount: number; reason: string; idempotencyKey: string; sourceId?: string },
) {
  validateUserId(input.userId);
  validatePositiveInteger(input.amount, "amount");
  validateReason(input.reason);
  validateIdempotencyKey(input.idempotencyKey);

  const existing = await transaction.pointLedger.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) {
    if (existing.userId !== input.userId || existing.amount !== -input.amount || existing.type !== "REVERSAL") {
      throw new Error("IDEMPOTENCY_KEY_CONFLICT");
    }
    return existing;
  }

  const updated = await transaction.user.updateMany({
    where: { id: input.userId },
    data: { points: { decrement: input.amount } },
  });
  if (updated.count !== 1) throw new Error("User not found");
  const user = await transaction.user.findUnique({ where: { id: input.userId }, select: { points: true } });
  if (!user) throw new Error("User not found");
  return transaction.pointLedger.create({
    data: {
      userId: input.userId,
      type: "REVERSAL",
      amount: -input.amount,
      balanceAfter: user.points,
      reason: input.reason,
      sourceId: input.sourceId,
      idempotencyKey: input.idempotencyKey,
    },
  });
}

function validatePositiveInteger(
  value: number,
  fieldName: string,
): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(
      `${fieldName} must be a positive safe integer`,
    );
  }
}

function validateNonZeroInteger(
  value: number,
  fieldName: string,
): void {
  if (!Number.isSafeInteger(value) || value === 0) {
    throw new Error(
      `${fieldName} must be a non-zero safe integer`,
    );
  }
}

function validateUserId(userId: string): void {
  if (!userId || typeof userId !== "string") {
    throw new Error("Invalid userId");
  }
}

function validateReason(reason: string): void {
  if (
    !reason ||
    typeof reason !== "string" ||
    reason.trim().length === 0
  ) {
    throw new Error("A reason is required");
  }

  if (reason.length > 500) {
    throw new Error(
      "Reason cannot be longer than 500 characters",
    );
  }
}

function validateIdempotencyKey(
  idempotencyKey: string,
): void {
  if (
    !idempotencyKey ||
    typeof idempotencyKey !== "string" ||
    idempotencyKey.trim().length === 0
  ) {
    throw new Error("A valid idempotencyKey is required");
  }

  if (idempotencyKey.length > 255) {
    throw new Error(
      "idempotencyKey cannot be longer than 255 characters",
    );
  }
}

const SERIALIZATION_RETRIES = 3;

/**
 * Serializable transactions can be aborted by PostgreSQL (P2034) when two
 * writers touch the same rows. That is not a failure of the operation, only a
 * lost race, so it is retried a few times before surfacing the error.
 */
async function runSerializable<T>(
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < SERIALIZATION_RETRIES; attempt += 1) {
    try {
      return await db.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      lastError = error;
      const code = (error as { code?: string } | null)?.code;
      if (code !== "P2034") throw error;
    }
  }
  throw lastError;
}

type LedgerExpectation = {
  userId: string;
  amount: number;
  type: "CREDIT" | "DEBIT" | "REFUND" | "ADJUSTMENT";
  reason: string;
};

/**
 * An idempotency key may only ever replay the exact same operation. Reusing a
 * key for a different user, amount, type or reason is a client bug (or an
 * attack) and must fail loudly instead of silently returning the old entry.
 */
function assertLedgerMatches<T extends { userId: string; amount: number; type: string; reason: string }>(
  existing: T,
  expected: LedgerExpectation,
): T {
  if (
    existing.userId !== expected.userId ||
    existing.amount !== expected.amount ||
    existing.type !== expected.type ||
    existing.reason !== expected.reason
  ) {
    throw new Error("IDEMPOTENCY_KEY_CONFLICT");
  }
  return existing;
}

async function getExistingLedgerEntry(
  idempotencyKey: string,
) {
  return db.pointLedger.findUnique({
    where: {
      idempotencyKey,
    },
  });
}

async function findMatchingTransactionLedger(
  transaction: Prisma.TransactionClient,
  input: { userId: string; amount: number; reason: string; idempotencyKey: string },
  type: "CREDIT" | "DEBIT",
  ledgerAmount: number,
) {
  const existing = await transaction.pointLedger.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (!existing) return null;
  if (existing.userId !== input.userId || existing.amount !== ledgerAmount || existing.type !== type || existing.reason !== input.reason) {
    throw new Error("IDEMPOTENCY_KEY_CONFLICT");
  }
  return existing;
}

export async function creditPointsInTransaction(
  transaction: Prisma.TransactionClient,
  input: CreditPointsInput,
) {
  validateUserId(input.userId);
  validatePositiveInteger(input.amount, "amount");
  validateReason(input.reason);
  validateIdempotencyKey(input.idempotencyKey);

  const existing = await findMatchingTransactionLedger(transaction, input, "CREDIT", input.amount);
  if (existing) return existing;

  const updated = await transaction.user.updateMany({ where: { id: input.userId }, data: { points: { increment: input.amount } } });
  if (updated.count !== 1) throw new Error("User not found");
  const user = await transaction.user.findUnique({ where: { id: input.userId }, select: { points: true } });
  if (!user) throw new Error("User not found");

  return transaction.pointLedger.create({
    data: {
      userId: input.userId,
      type: "CREDIT",
      amount: input.amount,
      balanceAfter: user.points,
      reason: input.reason,
      sourceId: input.sourceId,
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata,
    },
  });
}

export async function debitPointsInTransaction(
  transaction: Prisma.TransactionClient,
  input: DebitPointsInput,
) {
  validateUserId(input.userId);
  validatePositiveInteger(input.amount, "amount");
  validateReason(input.reason);
  validateIdempotencyKey(input.idempotencyKey);

  const existing = await findMatchingTransactionLedger(transaction, input, "DEBIT", -input.amount);
  if (existing) return existing;

  const updated = await transaction.user.updateMany({
    where: { id: input.userId, points: { gte: input.amount } },
    data: { points: { decrement: input.amount } },
  });
  if (updated.count !== 1) throw new Error("INSUFFICIENT_POINTS");
  const user = await transaction.user.findUnique({ where: { id: input.userId }, select: { points: true } });
  if (!user) throw new Error("User not found");

  return transaction.pointLedger.create({
    data: {
      userId: input.userId,
      type: "DEBIT",
      amount: -input.amount,
      balanceAfter: user.points,
      reason: input.reason,
      sourceId: input.sourceId,
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata,
    },
  });
}

/**
 * Single code path for every stand-alone ledger write (credit, debit, refund,
 * adjustment). Keeping one implementation guarantees that every operation:
 *  - validates its input the same way,
 *  - is idempotent and rejects a reused key with different parameters,
 *  - changes the balance with one atomic statement (no read-modify-write),
 *  - never lets a debit take the balance below zero,
 *  - writes the ledger row in the same transaction as the balance change.
 */
async function postLedgerEntry(
  input: CreditPointsInput,
  type: LedgerExpectation["type"],
  signedAmount: number,
  insufficientError: string,
) {
  validateUserId(input.userId);
  validateReason(input.reason);
  validateIdempotencyKey(input.idempotencyKey);

  const expected: LedgerExpectation = {
    userId: input.userId,
    amount: signedAmount,
    type,
    reason: input.reason,
  };

  const existing = await getExistingLedgerEntry(input.idempotencyKey);
  if (existing) return assertLedgerMatches(existing, expected);

  try {
    return await runSerializable(async (tx) => {
      const existingInsideTransaction = await tx.pointLedger.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (existingInsideTransaction) {
        return assertLedgerMatches(existingInsideTransaction, expected);
      }

      const updated =
        signedAmount >= 0
          ? await tx.user.updateMany({
              where: { id: input.userId },
              data: { points: { increment: signedAmount } },
            })
          : await tx.user.updateMany({
              where: { id: input.userId, points: { gte: -signedAmount } },
              data: { points: { decrement: -signedAmount } },
            });

      if (updated.count !== 1) {
        const known = await tx.user.findUnique({
          where: { id: input.userId },
          select: { id: true },
        });
        if (!known) throw new Error("User not found");
        throw new Error(insufficientError);
      }

      const user = await tx.user.findUnique({
        where: { id: input.userId },
        select: { points: true },
      });
      if (!user) throw new Error("User not found");

      return tx.pointLedger.create({
        data: {
          userId: input.userId,
          type,
          amount: signedAmount,
          balanceAfter: user.points,
          reason: input.reason,
          sourceId: input.sourceId,
          idempotencyKey: input.idempotencyKey,
          metadata: input.metadata,
        },
      });
    });
  } catch (error) {
    // Two identical requests can race on the unique idempotency key. The loser
    // rolls back and simply returns what the winner wrote.
    const existingAfterError = await getExistingLedgerEntry(input.idempotencyKey);
    if (existingAfterError) return assertLedgerMatches(existingAfterError, expected);
    throw error;
  }
}

export async function creditPoints(input: CreditPointsInput) {
  validatePositiveInteger(input.amount, "amount");
  return postLedgerEntry(input, "CREDIT", input.amount, "INSUFFICIENT_POINTS");
}

export async function debitPoints(input: DebitPointsInput) {
  validatePositiveInteger(input.amount, "amount");
  return postLedgerEntry(input, "DEBIT", -input.amount, "INSUFFICIENT_POINTS");
}

export async function adjustPoints(input: AdjustPointsInput) {
  validateNonZeroInteger(input.amount, "amount");
  return postLedgerEntry(input, "ADJUSTMENT", input.amount, "ADJUSTMENT_WOULD_MAKE_POINTS_NEGATIVE");
}

export async function refundPoints(input: CreditPointsInput) {
  validatePositiveInteger(input.amount, "amount");
  return postLedgerEntry(input, "REFUND", input.amount, "INSUFFICIENT_POINTS");
}

export async function getPointBalance(
  userId: string,
): Promise<number> {
  validateUserId(userId);

  const user = await db.user.findUnique({
    where: {
      id: userId,
    },
    select: {
      points: true,
    },
  });

  if (!user) {
    throw new Error("User not found");
  }

  return user.points;
}

export async function getPointLedger(
  userId: string,
  limit = 50,
) {
  validateUserId(userId);

  if (
    !Number.isInteger(limit) ||
    limit <= 0 ||
    limit > 100
  ) {
    throw new Error(
      "limit must be an integer between 1 and 100",
    );
  }

  return db.pointLedger.findMany({
    where: {
      userId,
    },
    orderBy: {
      createdAt: "desc",
    },
    take: limit,
  });
}
