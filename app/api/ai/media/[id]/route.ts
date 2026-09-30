import { NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { db } from "@/lib/prisma";
import { getOptionalUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Ctx) {
  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { id } = await params;
  const job = await db.aiMediaJob.findFirst({ where: { id, userId: user.id } });
  if (!job) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ job });
}

export async function DELETE(_: Request, { params }: Ctx) {
  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { id } = await params;
  const job = await db.aiMediaJob.findFirst({
    where: { id, userId: user.id },
    select: { id: true, resultUrl: true },
  });
  if (!job) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  if (job.resultUrl && process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      await del(job.resultUrl, { token: process.env.BLOB_READ_WRITE_TOKEN });
    } catch {
      // Database deletion remains authoritative.
    }
  }

  await db.aiMediaJob.delete({ where: { id: job.id } });
  return NextResponse.json({ success: true });
}
