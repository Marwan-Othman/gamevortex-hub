import { NextResponse } from "next/server";
import { db } from "../../../../../lib/prisma";
import { getOptionalUser } from "../../../../../lib/auth";
import { getVipAccess } from "../../../../../lib/vip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeDownloadName(value: string | null | undefined, fallback: string) {
  const name = (value || fallback)
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 150);
  return name || fallback;
}

function filenameWithExtension(filename: string, mimeType: string | null | undefined) {
  if (/\.[a-z0-9]{2,8}$/i.test(filename)) return filename;
  const extensions: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/apng": ".apng",
    "image/avif": ".avif",
  };
  return `${filename}${extensions[mimeType || ""] || ""}`;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!id || id.length > 100) return NextResponse.json({ error: "Invalid wallpaper id" }, { status: 400 });

    const wallpaper = await db.wallpaper.findUnique({
      where: { id },
      select: {
        id: true,
        imageUrl: true,
        downloadUrl: true,
        mediaUrl: true,
        mediaType: true,
        published: true,
        isVip: true,
        moderationStatus: true,
        originalFilename: true,
        mimeType: true,
      },
    });

    if (!wallpaper || !wallpaper.published || wallpaper.moderationStatus !== "APPROVED") {
      return NextResponse.json({ error: "Wallpaper not found" }, { status: 404 });
    }

    if (wallpaper.isVip) {
      const user = await getOptionalUser();
      if (!user) return NextResponse.json({ error: "VIP_LOGIN_REQUIRED" }, { status: 401 });
      const access = await getVipAccess(user.id);
      if (!access.isVip) return NextResponse.json({ error: "VIP_REQUIRED" }, { status: 403 });
    }

    const targetUrl = wallpaper.downloadUrl || wallpaper.mediaUrl || wallpaper.imageUrl;
    const upstream = await fetch(targetUrl, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
      headers: { "user-agent": "GameVortex-Wallpaper-Downloader/1.0" },
    });

    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: "Wallpaper file is currently unavailable" }, { status: 502 });
    }

    const contentType = wallpaper.mimeType || upstream.headers.get("content-type") || "application/octet-stream";
    const baseName = safeDownloadName(wallpaper.originalFilename, `gamevortex-wallpaper-${wallpaper.id}`);
    const filename = filenameWithExtension(baseName, contentType.split(";", 1)[0].trim().toLowerCase());

    await db.wallpaper.update({ where: { id: wallpaper.id }, data: { downloadCount: { increment: 1 } } });

    const headers = new Headers();
    headers.set("Content-Type", contentType);
    headers.set("Content-Disposition", `attachment; filename="${filename.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    headers.set("Cache-Control", "private, no-store, max-age=0");
    headers.set("X-Content-Type-Options", "nosniff");

    const contentLength = upstream.headers.get("content-length");
    if (contentLength) headers.set("Content-Length", contentLength);

    return new Response(upstream.body, { status: 200, headers });
  } catch (error) {
    console.error("Wallpaper download error:", error);
    return NextResponse.json({ error: "Failed to process wallpaper download" }, { status: 500 });
  }
}
