import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DISTRIBUTABLE_STATUSES = [
  "OFFICIAL_SOURCE",
  "LICENSED_FOR_DISTRIBUTION",
  "OPEN_SOURCE",
  "FREEWARE_REDISTRIBUTABLE",
];

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

  const game = await db.game.findFirst({
    where: { slug, published: true },
    select: { id: true, downloadSource: true, sourceStatus: true },
  });

  if (!game?.downloadSource || !isGameVortexBlobUrl(game.downloadSource)) {
    return NextResponse.json({ success: false, error: "DOWNLOAD_NOT_AVAILABLE" }, { status: 404 });
  }
  if (!DISTRIBUTABLE_STATUSES.includes(game.sourceStatus)) {
    return NextResponse.json({ success: false, error: "DOWNLOAD_SOURCE_NOT_DISTRIBUTABLE" }, { status: 403 });
  }

  await db.game.update({
    where: { id: game.id },
    data: { downloadCount: { increment: 1 } },
  });

  const downloadUrl = new URL(game.downloadSource);
  downloadUrl.searchParams.set("download", "1");

  return NextResponse.redirect(downloadUrl.toString(), {
    status: 303,
    headers: {
      "Cache-Control": "no-store, private",
    },
  });
}
