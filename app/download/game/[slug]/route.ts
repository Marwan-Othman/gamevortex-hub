import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/prisma";
import { head } from "@vercel/blob";

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

function getDownloadFilename(blobUrl: string, fallback: string) {
  try {
    const pathname = decodeURIComponent(new URL(blobUrl).pathname);
    const raw = pathname.split("/").pop() || "";
    // Current upload path: <timestamp>-<UUID>-<original filename>
    const match = raw.match(/^\d+-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-(.+)$/i);
    const filename = match?.[1] || raw;
    return filename || fallback;
  } catch {
    return fallback;
  }
}

function contentDisposition(filename: string) {
  const safe = filename.replace(/[\\\r\n"]/g, "_").trim() || "download";
  const ascii = safe.replace(/[^\x20-\x7E]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const game = await db.game.findFirst({
    where: { slug, published: true },
    select: { id: true, downloadSource: true, sourceStatus: true, titleEn: true },
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

  // Android DownloadManager needs a reliable total size. Vercel Blob exposes the
  // authoritative object size through head(), while the GET response may be streamed.
  let blobSize: number | null = null;
  try {
    const metadata = await head(game.downloadSource, {
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    blobSize = metadata.size;
  } catch {
    // Fall back to the upstream GET headers below if metadata lookup is unavailable.
  }

  const upstreamHeaders = new Headers();
  const range = request.headers.get("range");
  const ifRange = request.headers.get("if-range");
  const ifNoneMatch = request.headers.get("if-none-match");
  if (range) upstreamHeaders.set("Range", range);
  if (ifRange) upstreamHeaders.set("If-Range", ifRange);
  if (ifNoneMatch) upstreamHeaders.set("If-None-Match", ifNoneMatch);

  const downloadUrl = new URL(game.downloadSource);
  downloadUrl.searchParams.set("download", "1");

  let upstream: Response;
  try {
    upstream = await fetch(downloadUrl, {
      headers: upstreamHeaders,
      redirect: "follow",
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ success: false, error: "DOWNLOAD_SOURCE_UNREACHABLE" }, { status: 502 });
  }

  if (!upstream.ok && upstream.status !== 206 && upstream.status !== 304) {
    return NextResponse.json({ success: false, error: "DOWNLOAD_SOURCE_UNAVAILABLE" }, { status: 502 });
  }

  const headers = new Headers();
  for (const name of [
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
    "etag",
    "last-modified",
    "cache-control",
  ]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }

  const filename = getDownloadFilename(game.downloadSource, `${game.titleEn || slug}.bin`);
  if (!headers.has("Content-Length") && blobSize !== null) {
    headers.set("Content-Length", String(blobSize));
  }
  headers.set("Content-Disposition", contentDisposition(filename));
  headers.set("Cache-Control", "public, max-age=0, must-revalidate");

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers,
  });
}
