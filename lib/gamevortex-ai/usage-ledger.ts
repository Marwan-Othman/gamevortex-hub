import { AiUsageStatus, Prisma } from '@prisma/client';
import { db } from '@/lib/prisma';

export type AiUsageStartInput = {
  userId: string;
  provider: string;
  operation: string;
  idempotencyKey: string;
  gvcReserved?: number;
  requestId?: string;
  taskId?: string;
};

export async function startAiUsage(input: AiUsageStartInput) {
  const provider = input.provider.trim();
  const operation = input.operation.trim();

  if (!input.userId || !provider || !operation || !input.idempotencyKey) {
    throw new Error('INVALID_AI_USAGE_REQUEST');
  }

  const gvcReserved = input.gvcReserved ?? 0;
  if (!Number.isSafeInteger(gvcReserved) || gvcReserved < 0) {
    throw new Error('INVALID_AI_USAGE_GVC');
  }

  const existing = await db.aiUsageLedger.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });

  if (existing) {
    if (existing.userId !== input.userId) {
      throw new Error('AI_USAGE_IDEMPOTENCY_OWNERSHIP_MISMATCH');
    }
    return { usage: existing, alreadyApplied: true };
  }

  const usage = await db.aiUsageLedger.create({
    data: {
      userId: input.userId,
      provider,
      operation,
      requestId: input.requestId?.trim() || null,
      taskId: input.taskId?.trim() || null,
      gvcReserved,
      status: AiUsageStatus.QUEUED,
    },
  });

  return { usage, alreadyApplied: false };
}

export async function updateAiUsage(
  usageId: string,
  userId: string,
  patch: {
    status?: AiUsageStatus;
    requestId?: string | null;
    taskId?: string | null;
    startedAt?: Date | null;
    finishedAt?: Date | null;
    gvcUsed?: number;
    gvcRefunded?: number;
    providerCost?: Prisma.Decimal | number | string | null;
    errorCode?: string | null;
  },
) {
  if (!usageId || !userId) throw new Error('INVALID_AI_USAGE_UPDATE');

  for (const value of [patch.gvcUsed, patch.gvcRefunded]) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      throw new Error('INVALID_AI_USAGE_GVC');
    }
  }

  const existing = await db.aiUsageLedger.findUnique({ where: { id: usageId } });
  if (!existing || existing.userId !== userId) {
    throw new Error('AI_USAGE_NOT_FOUND');
  }

  return db.aiUsageLedger.update({
    where: { id: usageId },
    data: {
      status: patch.status,
      requestId: patch.requestId === undefined ? undefined : patch.requestId?.trim() || null,
      taskId: patch.taskId === undefined ? undefined : patch.taskId?.trim() || null,
      startedAt: patch.startedAt,
      finishedAt: patch.finishedAt,
      gvcUsed: patch.gvcUsed,
      gvcRefunded: patch.gvcRefunded,
      providerCost:
        patch.providerCost === undefined
          ? undefined
          : patch.providerCost === null
            ? null
            : new Prisma.Decimal(patch.providerCost),
      errorCode: patch.errorCode === undefined ? undefined : patch.errorCode?.slice(0, 120) || null,
    },
  });
}

export async function finishAiUsage(
  usageId: string,
  userId: string,
  result: {
    status: Extract<AiUsageStatus, 'COMPLETED' | 'FAILED' | 'STOPPED' | 'CANCELLED'>;
    gvcUsed?: number;
    gvcRefunded?: number;
    providerCost?: Prisma.Decimal | number | string | null;
    errorCode?: string | null;
    finishedAt?: Date;
  },
) {
  return updateAiUsage(usageId, userId, {
    ...result,
    finishedAt: result.finishedAt ?? new Date(),
  });
}
