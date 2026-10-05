import { AiCreditKind, Prisma } from '@prisma/client';
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
    if (existing) return { consumed: true, alreadyApplied: true, amount: Math.abs(existing.delta) };
    const balance = await tx.aiCreditBalance.upsert({ where: { userId }, create: { userId }, update: {} });
    const current = Number(balance.gvcBalance);
    if (!Number.isSafeInteger(current) || current < amount) throw new Error('AI_CREDITS_EXHAUSTED');
    await tx.aiCreditBalance.update({ where: { userId }, data: { gvcBalance: { decrement: amount } } });
    await tx.aiCreditLedger.create({ data: { userId, kind, delta: -amount, reason: 'AI_GVC_RESERVATION', referenceId: idempotencyKey, idempotencyKey: scopedKey } });
    return { consumed: true, alreadyApplied: false, amount };
  });
}

export async function refundAiCredit(
  userId: string,
  kind: AiCreditKind,
  idempotencyKey: string,
  amount = 1,
) {
  if (!userId || !idempotencyKey || !Number.isSafeInteger(amount) || amount <= 0) throw new Error('INVALID_CREDIT_REQUEST');
  return db.$transaction(async tx => {
    const refundKey = `${userId}:refund:${idempotencyKey}`;
    const existing = await tx.aiCreditLedger.findUnique({ where: { idempotencyKey: refundKey } });
    if (existing) return;
    await tx.aiCreditBalance.upsert({ where: { userId }, create: { userId, gvcBalance: amount }, update: { gvcBalance: { increment: amount } } });
    await tx.aiCreditLedger.create({ data: { userId, kind, delta: amount, reason: 'AI_GVC_REFUND', referenceId: idempotencyKey, idempotencyKey: refundKey } });
  });
}

export async function getGvcBalance(userId: string): Promise<number> {
  if (!userId) throw new Error('USER_ID_REQUIRED');
  const balance = await db.aiCreditBalance.findUnique({ where: { userId }, select: { gvcBalance: true } });
  return balance?.gvcBalance ?? 0;
}
