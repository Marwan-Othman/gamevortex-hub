import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/prisma";
import { normalizeExternalSourceUrl } from "@/lib/content-admin";

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

  if (!app?.downloadSource || !(/^https:\/\/[a-z0-9.-]+\.public\.blob\.vercel-storage\.com\//i.test(app.downloadSource) || normalizeExternalSourceUrl(app.downloadSource) !== null)) {
    return NextResponse.json({ success: false, error: "DOWNLOAD_NOT_AVAILABLE" }, { status: 404 });
  }

  if (!["OFFICIAL_SOURCE", "LICENSED_FOR_DISTRIBUTION", "OPEN_SOURCE", "FREEWARE_REDISTRIBUTABLE"].includes(app.sourceStatus)) {
    return NextResponse.json({ success: false, error: "DOWNLOAD_SOURCE_NOT_DISTRIBUTABLE" }, { status: 403 });
  }

  await db.app.update({ where: { id: app.id }, data: { downloadCount: { increment: 1 } } });

  return NextResponse.redirect(app.downloadSource, { status: 302 });
}
