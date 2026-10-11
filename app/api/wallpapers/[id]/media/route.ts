import { NextResponse } from "next/server";
import { db } from "@/lib/prisma";
import { getOptionalUser } from "@/lib/auth";
import { getVipAccess } from "@/lib/vip";
import { openWallpaperSource } from "@/lib/wallpaper-delivery";
import { guardRead } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const blocked = await guardRead(request, "wallpapers:media", 240);
  if (blocked) return blocked;
  try {
    const { id } = await params;
    if (!id || id.length > 100) {
      return NextResponse.json({ error: "Invalid wallpaper id" }, { status: 400 });
    }

    const wallpaper = await db.wallpaper.findUnique({
      where: { id },
      select: {
        id: true,
        imageUrl: true,
        mediaUrl: true,
        mediaType: true,
        thumbnailUrl: true,
        mimeType: true,
        published: true,
        isVip: true,
        moderationStatus: true,
        originalFilename: true,
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

    // Grid/list cards pass ?thumb=1 so they download the (small) thumbnail when the wallpaper has
    // one, instead of the full-resolution original. Detail pages and downloads omit it.
    const wantsThumb = new URL(request.url).searchParams.get("thumb") === "1";
    const useThumb = wantsThumb && wallpaper.mediaType !== "VIDEO" && Boolean(wallpaper.thumbnailUrl);

    const target = useThumb
      ? (wallpaper.thumbnailUrl as string)
      : wallpaper.mediaType === "VIDEO" && wallpaper.mediaUrl
        ? wallpaper.mediaUrl
        : wallpaper.imageUrl;

    const opened = await openWallpaperSource(target);
    const headers = new Headers();
    // mimeType describes the original file, so a thumbnail keeps the type detected from its own bytes/extension.
    headers.set("Content-Type", useThumb ? opened.contentType : wallpaper.mimeType || opened.contentType);
    headers.set(
      "Cache-Control",
      wallpaper.isVip
        ? "private, no-store"
        : "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
    );
    if (wallpaper.isVip) headers.set("Vary", "Cookie");
    headers.set("X-Content-Type-Options", "nosniff");
    // Served from our origin: never let an image/SVG execute script or be framed.
    headers.set("Content-Security-Policy", "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox");
    headers.set("Cross-Origin-Resource-Policy", "same-origin");
    if (opened.contentLength) headers.set("Content-Length", String(opened.contentLength));
    return new Response(opened.stream, { status: 200, headers });
  } catch (error) {
    console.error("Wallpaper media error:", error);
    return NextResponse.json({ error: "Failed to serve wallpaper media" }, { status: 502 });
  }
}
