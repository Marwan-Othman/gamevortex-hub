import { NextResponse } from "next/server";
import { db } from "../../../../../lib/prisma";
import { getOptionalUser } from "../../../../../lib/auth";
import { getVipAccess } from "../../../../../lib/vip";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!id || id.length > 100) return NextResponse.json({ error: "Invalid wallpaper id" }, { status: 400 });

    const wallpaper = await db.wallpaper.findUnique({ where: { id }, select: { id: true, imageUrl: true, downloadUrl: true, mediaUrl: true, mediaType: true, published: true, isVip: true, moderationStatus: true } });
    if (!wallpaper || !wallpaper.published || wallpaper.moderationStatus !== "APPROVED") return NextResponse.json({ error: "Wallpaper not found" }, { status: 404 });

    if (wallpaper.isVip) {
      const user = await getOptionalUser();
      if (!user) return NextResponse.json({ error: "VIP_LOGIN_REQUIRED" }, { status: 401 });
      const access = await getVipAccess(user.id);
      if (!access.isVip) return NextResponse.json({ error: "VIP_REQUIRED" }, { status: 403 });
    }

    const targetUrl = wallpaper.downloadUrl || wallpaper.mediaUrl || wallpaper.imageUrl;
    await db.wallpaper.update({ where: { id: wallpaper.id }, data: { downloadCount: { increment: 1 } } });
    const redirectTarget = targetUrl.startsWith("/") ? new URL(targetUrl, request.url) : targetUrl;
    return NextResponse.redirect(redirectTarget, { status: 302 });
  } catch (error) {
    console.error("Wallpaper download error:", error);
    return NextResponse.json({ error: "Failed to process wallpaper download" }, { status: 500 });
  }
}
