import { NextRequest } from "next/server";
import { handleDownload } from "@/lib/download-handler";
import { db } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Same rules as /download/game/[slug]: validate, count, redirect straight to the file host. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return handleDownload(request, {
    scope: "download:app",
    find: () =>
      db.app.findFirst({
        where: { slug, published: true },
        select: { id: true, downloadSource: true, sourceStatus: true },
      }),
    countDownload: (id) => db.app.update({ where: { id }, data: { downloadCount: { increment: 1 } } }),
  });
}
