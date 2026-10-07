import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const game = await db.game.findFirst({
    where: { slug, published: true },
    select: { id: true, titleEn: true, downloadSource: true, sourceStatus: true },
  });

  if (!game?.downloadSource || !/^https:\/\/[a-z0-9.-]+\.public\.blob\.vercel-storage\.com\//i.test(game.downloadSource)) {
    return NextResponse.json({ success: false, error: "DOWNLOAD_NOT_AVAILABLE" }, { status: 404 });
  }

  if (!["OFFICIAL_SOURCE", "LICENSED_FOR_DISTRIBUTION", "OPEN_SOURCE", "FREEWARE_REDISTRIBUTABLE"].includes(game.sourceStatus)) {
    return NextResponse.json({ success: false, error: "DOWNLOAD_SOURCE_NOT_DISTRIBUTABLE" }, { status: 403 });
  }

  await db.game.update({ where: { id: game.id }, data: { downloadCount: { increment: 1 } } });

  return NextResponse.redirect(game.downloadSource, { status: 302 });
}
