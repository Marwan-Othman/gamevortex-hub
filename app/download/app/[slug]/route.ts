import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/prisma";
import { normalizeExternalSourceUrl } from "@/lib/content-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isGameVortexBlobUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.endsWith(".blob.vercel-storage.com");
  } catch {
    return false;
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const app = await db.app.findFirst({
    where: { slug, published: true },
    select: { id: true, downloadSource: true, sourceStatus: true },
  });

  if (
    !app?.downloadSource ||
    (!isGameVortexBlobUrl(app.downloadSource) &&
      normalizeExternalSourceUrl(app.downloadSource) === null)
  ) {
    return NextResponse.json(
      { success: false, error: "DOWNLOAD_NOT_AVAILABLE" },
      { status: 404 },
    );
  }

  if (
    ![
      "OFFICIAL_SOURCE",
      "LICENSED_FOR_DISTRIBUTION",
      "OPEN_SOURCE",
      "FREEWARE_REDISTRIBUTABLE",
    ].includes(app.sourceStatus)
  ) {
    return NextResponse.json(
      { success: false, error: "DOWNLOAD_SOURCE_NOT_DISTRIBUTABLE" },
      { status: 403 },
    );
  }

  await db.app.update({
    where: { id: app.id },
    data: { downloadCount: { increment: 1 } },
  });

  // Large files must be served directly by Blob, not streamed through a serverless function.
  // Remove legacy ?download=1 query strings from our Blob URLs so the browser can determine
  // the file size and use HTTP range/resume support. Preserve query strings on external hosts.
  const downloadUrl = new URL(app.downloadSource);
  if (isGameVortexBlobUrl(app.downloadSource)) downloadUrl.search = "";
  downloadUrl.hash = "";

  return NextResponse.redirect(downloadUrl.toString(), {
    status: 303,
    headers: { "Cache-Control": "no-store, private" },
  });
}
