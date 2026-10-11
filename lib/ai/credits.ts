import { AiCreditKind, Prisma, Role, VipSubscriptionStatus } from '@prisma/client';
import { db } from '@/lib/prisma';
import { logSystemError } from '@/lib/observability';

/**
 * Credits may only be spent while the account is entitled to VIP (the owner,
 * or a subscription that is ACTIVE and not past its expiry). The routes check
 * this before calling in, but the check is repeated inside the same
 * transaction that takes the credits, so a subscription that expires or is
 * refunded between the route check and the debit cannot spend anything.
 */
async function assertVipEntitledInTransaction(tx: Prisma.TransactionClient, userId: string) {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user) throw new Error('AI_VIP_REQUIRED');
  if (user.role === Role.SUPER_ADMIN) return;

  const subscription = await tx.vipSubscription.findFirst({
    where: {
      userId,
      status: VipSubscriptionStatus.ACTIVE,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { id: true },
  });
  if (!subscription) throw new Error('AI_VIP_REQUIRED');
}

export type ConsumeAiCreditResult = {
  consumed: true;
  /** True when this exact key had already reserved credits (nothing new was taken). */
  alreadyApplied: boolean;
  amount: number;
};

export async function consumeAiCredit(
  userId: string,
  kind: AiCreditKind,
  idempotencyKey: string,
  amount = 1,
): Promise<ConsumeAiCreditResult> {
  if (!userId || !idempotencyKey || !Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error('INVALID_CREDIT_REQUEST');
  }

  const scopedKey = `${userId}:${idempotencyKey}`;
  try {
    return await db.$transaction(async (tx): Promise<ConsumeAiCreditResult> => {
      const existing = await tx.aiCreditLedger.findUnique({ where: { idempotencyKey: scopedKey } });
      if (existing) {
        return resolveExistingReservation(tx, userId, kind, idempotencyKey, amount, existing);
      }

      await assertVipEntitledInTransaction(tx, userId);

      await tx.aiCreditBalance.upsert({
        where: { userId },
        create: { userId },
        update: {},
      });

      // One conditional statement checks the balance AND takes the credits.
      // Reading the balance first and decrementing afterwards lets two parallel
      // requests both pass the check and push the balance below zero.
      const taken = await tx.aiCreditBalance.updateMany({
        where: { userId, gvcBalance: { gte: amount } },
        data: { gvcBalance: { decrement: amount } },
      });
      if (taken.count !== 1) {
        throw new Error('AI_CREDITS_EXHAUSTED');
      }

      await tx.aiCreditLedger.create({
        data: {
          userId,
          kind,
          delta: -amount,
          reason: 'AI_GVC_RESERVATION',
          referenceId: idempotencyKey,
          idempotencyKey: scopedKey,
        },
      });

      return { consumed: true, alreadyApplied: false, amount };
    });
  } catch (error) {
    // Same key sent twice at the same moment: the loser rolled back (so it took
    // nothing) and reports the winner's reservation instead of failing.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const winner = await db.aiCreditLedger.findUnique({ where: { idempotencyKey: scopedKey } });
      if (winner) return db.$transaction((tx) => resolveExistingReservation(tx, userId, kind, idempotencyKey, amount, winner));
    }
    throw error;
  }
}

/**
 * A key that was already used. Replaying the *same* reservation is fine (the
 * caller must not charge again), but a key must never be a way to get work
 * done for free: it cannot be reused for a different amount or kind, and it
 * cannot be reused once its reservation has been refunded.
 */
async function resolveExistingReservation(
  tx: Prisma.TransactionClient,
  userId: string,
  kind: AiCreditKind,
  idempotencyKey: string,
  amount: number,
  existing: { delta: number; kind: AiCreditKind },
): Promise<ConsumeAiCreditResult> {
  if (existing.delta >= 0 || Math.abs(existing.delta) !== amount || existing.kind !== kind) {
    throw new Error('AI_IDEMPOTENCY_KEY_CONFLICT');
  }
  const refund = await tx.aiCreditLedger.findUnique({
    where: { idempotencyKey: `${userId}:refund:${idempotencyKey}` },
    select: { id: true },
  });
  if (refund) throw new Error('AI_IDEMPOTENCY_KEY_CONFLICT');
  return { consumed: true, alreadyApplied: true, amount };
}

export async function refundAiCredit(
  userId: string,
  kind: AiCreditKind,
  idempotencyKey: string,
  amount = 1,
) {
  if (!userId || !idempotencyKey || !Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error('INVALID_CREDIT_REQUEST');
  }

  return refundAiCreditOnce(userId, kind, idempotencyKey, amount).catch(async error => {
    // Callers deliberately ignore refund failures so the user still sees the
    // original error. A refund that did not happen is money owed to the user,
    // so it must at least be recorded where an operator can find it.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { refunded: true, alreadyApplied: true, amount };
    }
    await logSystemError('ai:credit-refund-failed', error, { userId, metadata: { kind, idempotencyKey, amount } });
    throw error;
  });
}

async function refundAiCreditOnce(
  userId: string,
  kind: AiCreditKind,
  idempotencyKey: string,
  amount: number,
) {
  return db.$transaction(async tx => {
    const reservationKey = `${userId}:${idempotencyKey}`;
    const refundKey = `${userId}:refund:${idempotencyKey}`;

    const reservation = await tx.aiCreditLedger.findUnique({
      where: { idempotencyKey: reservationKey },
    });
    if (!reservation) {
      throw new Error('AI_CREDIT_RESERVATION_NOT_FOUND');
    }

    const reservedAmount = Math.abs(reservation.delta);
    if (!Number.isSafeInteger(reservedAmount) || reservedAmount <= 0) {
      throw new Error('AI_CREDIT_RESERVATION_INVALID');
    }

    const refundAmount = amount;
    if (refundAmount > reservedAmount) {
      throw new Error('AI_CREDIT_REFUND_EXCEEDS_RESERVATION');
    }

    const existingRefund = await tx.aiCreditLedger.findUnique({
      where: { idempotencyKey: refundKey },
    });
    if (existingRefund) return { refunded: true, alreadyApplied: true, amount: refundAmount };

    await tx.aiCreditBalance.upsert({
      where: { userId },
      create: { userId, gvcBalance: refundAmount },
      update: { gvcBalance: { increment: refundAmount } },
    });
    await tx.aiCreditLedger.create({
      data: {
        userId,
        kind,
        delta: refundAmount,
        reason: 'AI_GVC_REFUND',
        referenceId: idempotencyKey,
        idempotencyKey: refundKey,
      },
    });

    return { refunded: true, alreadyApplied: false, amount: refundAmount };
  });
}

export async function getGvcBalance(userId: string): Promise<number> {
  if (!userId) throw new Error('USER_ID_REQUIRED');
  const balance = await db.aiCreditBalance.findUnique({
    where: { userId },
    select: { gvcBalance: true },
  });
  return balance?.gvcBalance ?? 0;
}
