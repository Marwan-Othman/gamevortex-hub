import { NextResponse } from "next/server";
import { db } from "../../../../../lib/prisma";
import { getOptionalUser } from "../../../../../lib/auth";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getOptionalUser();
    if (!user) return NextResponse.json({ success: false, error: "UNAUTHORIZED" }, { status: 401 });
    const { id } = await params;
    if (!id || id.length > 100) return NextResponse.json({ success: false, error: "INVALID_ID" }, { status: 400 });

    const wallpaper = await db.wallpaper.findUnique({ where: { id }, select: { id: true, published: true } });
    if (!wallpaper?.published) return NextResponse.json({ success: false, error: "NOT_FOUND" }, { status: 404 });

    const existing = await db.wallpaperFavorite.findUnique({
      where: { userId_wallpaperId: { userId: user.id, wallpaperId: id } },
    });

    if (existing) {
      await db.wallpaperFavorite.delete({ where: { id: existing.id } });
      return NextResponse.json({ success: true, favorited: false });
    }

    await db.wallpaperFavorite.create({ data: { userId: user.id, wallpaperId: id } });
    return NextResponse.json({ success: true, favorited: true });
  } catch (error) {
    console.error("Wallpaper favorite error:", error);
    return NextResponse.json({ success: false, error: "FAILED" }, { status: 500 });
  }
}
