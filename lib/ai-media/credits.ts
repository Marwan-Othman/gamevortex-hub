import { AiCreditKind, Prisma } from '@prisma/client';
import { db } from '@/lib/prisma';

function field(kind: AiCreditKind) { return kind === 'IMAGE' ? 'imageCredits' : kind === 'VIDEO' ? 'videoCredits' : 'chatCredits'; }

export async function consumeAiCredit(userId: string, kind: AiCreditKind, idempotencyKey: string) {
  if (!userId || !idempotencyKey) throw new Error('INVALID_CREDIT_REQUEST');
  const scopedKey = `${userId}:${idempotencyKey}`;
  return db.$transaction(async tx => {
    const existing = await tx.aiCreditLedger.findUnique({ where: { idempotencyKey: scopedKey } });
    if (existing) return { consumed: true, alreadyApplied: true };
    const balance = await tx.aiCreditBalance.upsert({ where: { userId }, create: { userId }, update: {} });
    const key = field(kind) as keyof typeof balance;
    const amount = Number(balance[key]);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('AI_CREDITS_EXHAUSTED');
    const next = { [key]: amount - 1 } as Prisma.AiCreditBalanceUpdateInput;
    await tx.aiCreditBalance.update({ where: { userId }, data: next });
    await tx.aiCreditLedger.create({ data: { userId, kind, delta: -1, reason: 'AI_MEDIA_GENERATION', idempotencyKey: scopedKey } });
    return { consumed: true, alreadyApplied: false };
  });
}

export async function refundAiCredit(userId: string, kind: AiCreditKind, idempotencyKey: string) {
  return db.$transaction(async tx => {
    const refundKey = `${userId}:refund:${idempotencyKey}`;
    const existing = await tx.aiCreditLedger.findUnique({ where: { idempotencyKey: refundKey } });
    if (existing) return;
    const key = field(kind);
    await tx.aiCreditBalance.upsert({ where: { userId }, create: { userId, [key]: 1 }, update: { [key]: { increment: 1 } } });
    await tx.aiCreditLedger.create({ data: { userId, kind, delta: 1, reason: 'AI_MEDIA_REFUND', idempotencyKey: refundKey } });
  });
}
