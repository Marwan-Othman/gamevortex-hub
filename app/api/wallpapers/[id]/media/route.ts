import { NextResponse } from "next/server";
import { db } from "@/lib/prisma";
import { getOptionalUser } from "@/lib/auth";
import { getVipAccess } from "@/lib/vip";
import { openWallpaperSource } from "@/lib/wallpaper-delivery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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

    const target = wallpaper.mediaType === "VIDEO" && wallpaper.mediaUrl
      ? wallpaper.mediaUrl
      : wallpaper.imageUrl;

    const opened = await openWallpaperSource(target);
    const headers = new Headers();
    headers.set("Content-Type", wallpaper.mimeType || opened.contentType);
    headers.set(
      "Cache-Control",
      wallpaper.isVip
        ? "private, no-store"
        : "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
    );
    if (wallpaper.isVip) headers.set("Vary", "Cookie");
    headers.set("X-Content-Type-Options", "nosniff");
    if (opened.contentLength) headers.set("Content-Length", String(opened.contentLength));
    return new Response(opened.stream, { status: 200, headers });
  } catch (error) {
    console.error("Wallpaper media error:", error);
    return NextResponse.json({ error: "Failed to serve wallpaper media" }, { status: 502 });
  }
}
