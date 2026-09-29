import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { AiCreditKind, AiMediaKind, AiMediaProvider, AiMediaJobStatus } from '@prisma/client';
import { db } from '@/lib/prisma';
import { getOptionalUser } from '@/lib/auth';
import { getVipAccess } from '@/lib/vip';
import { consumeAiCredit, refundAiCredit } from '@/lib/ai-media/credits';
import { createVideo, generateImage } from '@/lib/ai-media/providers';

const bodySchema = z.object({ kind: z.enum(['IMAGE','VIDEO']), prompt: z.string().trim().min(3).max(4000), aspectRatio: z.string().max(20).optional(), idempotencyKey: z.string().min(8).max(128) });

export async function POST(req: NextRequest) {
  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const body = bodySchema.parse(await req.json());
  if (process.env.AI_MEDIA_ENABLED !== 'true') return NextResponse.json({ error: 'AI_MEDIA_PROVIDERS_DISABLED' }, { status: 503 });

  const access = await getVipAccess(user.id);
  const kind = body.kind === 'IMAGE' ? AiCreditKind.IMAGE : AiCreditKind.VIDEO;
  const scopedIdempotencyKey = `${user.id}:${body.idempotencyKey}`;
  const existing = await db.aiMediaJob.findUnique({ where: { idempotencyKey: scopedIdempotencyKey } });
  if (existing) return NextResponse.json({ job: existing, vip: access.isVip });
  await consumeAiCredit(user.id, kind, scopedIdempotencyKey);
  const provider = body.kind === 'IMAGE' ? AiMediaProvider.FAL : AiMediaProvider.MINIMAX;
  const job = await db.aiMediaJob.create({ data: { userId: user.id, kind: body.kind === 'IMAGE' ? AiMediaKind.IMAGE : AiMediaKind.VIDEO, provider, prompt: body.prompt, status: AiMediaJobStatus.PROCESSING, idempotencyKey: scopedIdempotencyKey } });
  try {
    if (body.kind === 'IMAGE') {
      const result = await generateImage(body.prompt, body.aspectRatio);
      const updated = await db.aiMediaJob.update({ where: { id: job.id }, data: { status: AiMediaJobStatus.COMPLETED, providerTaskId: result.requestId, resultUrl: result.url, model: result.model } });
      return NextResponse.json({ job: updated, vip: access.isVip });
    }
    const result = await createVideo(body.prompt);
    const updated = await db.aiMediaJob.update({ where: { id: job.id }, data: { status: AiMediaJobStatus.PROCESSING, providerTaskId: result.taskId, model: result.model } });
    return NextResponse.json({ job: updated, vip: access.isVip, pollingRequired: true }, { status: 202 });
  } catch (error) {
    await db.aiMediaJob.update({ where: { id: job.id }, data: { status: AiMediaJobStatus.FAILED, errorMessage: error instanceof Error ? error.message : 'UNKNOWN_ERROR' } });
    await refundAiCredit(user.id, kind, scopedIdempotencyKey);
    return NextResponse.json({ error: 'AI_MEDIA_GENERATION_FAILED' }, { status: 502 });
  }
}
