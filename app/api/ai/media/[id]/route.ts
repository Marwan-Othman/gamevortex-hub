import { NextResponse } from 'next/server';
import { AiMediaJobStatus } from '@prisma/client';
import { db } from '@/lib/prisma';
import { getOptionalUser } from '@/lib/auth';
import { getVideoStatus, retrieveFile } from '@/lib/ai-media/providers';
import { AiCreditKind } from '@prisma/client';
import { refundAiCredit } from '@/lib/ai-media/credits';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const { id } = await params;
  const job = await db.aiMediaJob.findFirst({ where: { id, userId: user.id } });
  if (!job) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });
  if (job.kind === 'VIDEO' && job.providerTaskId && job.status !== AiMediaJobStatus.COMPLETED && job.status !== AiMediaJobStatus.FAILED) {
    try {
      const status = await getVideoStatus(job.providerTaskId);
      const done = ['Success','succeed','SUCCESS'].includes(String(status.status));
      const failed = ['Fail','failed','FAILED'].includes(String(status.status));
      if (done && status.file_id) {
        const resultUrl = await retrieveFile(status.file_id);
        const updated = await db.aiMediaJob.update({ where: { id }, data: { status: AiMediaJobStatus.COMPLETED, providerFileId: status.file_id, resultUrl } });
        return NextResponse.json({ job: updated });
      }
      if (failed) {
        const updated = await db.aiMediaJob.update({ where: { id }, data: { status: AiMediaJobStatus.FAILED, errorMessage: status.base_resp?.status_msg || 'VIDEO_GENERATION_FAILED' } });
        await refundAiCredit(user.id, AiCreditKind.VIDEO, job.idempotencyKey);
        return NextResponse.json({ job: updated });
      }
    } catch { /* preserve last known job state */ }
  }
  return NextResponse.json({ job });
}
