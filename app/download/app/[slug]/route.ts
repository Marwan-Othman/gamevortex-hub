import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/prisma";
import { isVercelBlobHostname } from "@/lib/game-upload-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const app = await db.app.findFirst({
    where: { slug, published: true },
    select: { id: true, downloadSource: true, sourceStatus: true },
  });

  if (!app?.downloadSource) {
    return NextResponse.json({ success: false, error: "DOWNLOAD_NOT_AVAILABLE" }, { status: 404 });
  }
  try {
    const source = new URL(app.downloadSource);
    if (source.protocol !== "https:" || !isVercelBlobHostname(source.hostname)) {
      return NextResponse.json({ success: false, error: "DOWNLOAD_NOT_AVAILABLE" }, { status: 404 });
    }
  } catch {
    return NextResponse.json({ success: false, error: "DOWNLOAD_NOT_AVAILABLE" }, { status: 404 });
  }

  if (!["OFFICIAL_SOURCE", "LICENSED_FOR_DISTRIBUTION", "OPEN_SOURCE", "FREEWARE_REDISTRIBUTABLE"].includes(app.sourceStatus)) {
    return NextResponse.json({ success: false, error: "DOWNLOAD_SOURCE_NOT_DISTRIBUTABLE" }, { status: 403 });
  }

  await db.app.update({ where: { id: app.id }, data: { downloadCount: { increment: 1 } } });

  const downloadUrl = new URL(app.downloadSource);
  downloadUrl.search = "";
  downloadUrl.hash = "";
  return NextResponse.redirect(downloadUrl.toString(), { status: 302, headers: { "Cache-Control": "no-store, private" } });
}
