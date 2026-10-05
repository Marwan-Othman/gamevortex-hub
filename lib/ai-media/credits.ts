import { AiCreditKind } from '@prisma/client';
import { db } from '@/lib/prisma';

export async function consumeAiCredit(
  userId: string,
  kind: AiCreditKind,
  idempotencyKey: string,
  amount = 1,
) {
  if (!userId || !idempotencyKey || !Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error('INVALID_CREDIT_REQUEST');
  }

  const scopedKey = `${userId}:${idempotencyKey}`;
  return db.$transaction(async tx => {
    const existing = await tx.aiCreditLedger.findUnique({ where: { idempotencyKey: scopedKey } });
    if (existing) {
      return { consumed: true, alreadyApplied: true, amount: Math.abs(existing.delta) };
    }

    const balance = await tx.aiCreditBalance.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
    const current = Number(balance.gvcBalance);
    if (!Number.isSafeInteger(current) || current < amount) {
      throw new Error('AI_CREDITS_EXHAUSTED');
    }

    await tx.aiCreditBalance.update({
      where: { userId },
      data: { gvcBalance: { decrement: amount } },
    });
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
