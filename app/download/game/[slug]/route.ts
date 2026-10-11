import { NextRequest } from "next/server";
import { handleDownload } from "@/lib/download-handler";
import { db } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Game files can be hundreds of MB. They are NOT proxied through this function:
 * a serverless response is streamed without Content-Length (the browser shows "?" as the
 * total size) and is bound by the function's duration and bandwidth limits.
 * Instead we validate, count, and redirect to Vercel Blob, which serves the file directly
 * with Content-Length and Range/resume support. Blob URLs are stored and redirected without a
 * query string; verify Content-Length with: curl -sIL <download url>.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return handleDownload(request, {
    scope: "download:game",
    find: () =>
      db.game.findFirst({
        where: { slug, published: true },
        select: { id: true, downloadSource: true, sourceStatus: true },
      }),
    countDownload: (id) => db.game.update({ where: { id }, data: { downloadCount: { increment: 1 } } }),
  });
}
