import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/prisma";
import { getOptionalUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const conversationId = req.nextUrl.searchParams.get("conversationId");
  if (!conversationId) return NextResponse.json({ jobs: [] });

  const jobs = await db.aiMediaJob.findMany({
    where: { userId: user.id, conversationId },
    orderBy: { createdAt: "asc" },
    take: 100,
    select: {
      id: true,
      kind: true,
      status: true,
      prompt: true,
      resultUrl: true,
      errorMessage: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ jobs });
}

export async function POST() {
  // The independent GameVortex chat runtime is text/voice oriented.
  // Do not pretend that a chat model can generate image/video files.
  // Media storage/deletion remains supported for existing jobs/files.
  return NextResponse.json(
    { error: "AI_MEDIA_INTERNAL_RUNTIME_NOT_CONFIGURED" },
    { status: 503 },
  );
}
