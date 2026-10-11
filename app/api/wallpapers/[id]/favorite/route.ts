import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "../../../../../lib/prisma";
import { getOptionalUser } from "../../../../../lib/auth";
import { guardMutation } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const blocked = await guardMutation(request, "wallpapers:favorite", 30);
  if (blocked) return blocked;
  try {
    const user = await getOptionalUser();
    if (!user) return NextResponse.json({ success: false, error: "UNAUTHORIZED" }, { status: 401 });
    const { id } = await params;
    if (!id || id.length > 100) return NextResponse.json({ success: false, error: "INVALID_ID" }, { status: 400 });

    const wallpaper = await db.wallpaper.findUnique({ where: { id }, select: { id: true, published: true, moderationStatus: true } });
    if (!wallpaper?.published || wallpaper.moderationStatus !== "APPROVED") {
      return NextResponse.json({ success: false, error: "NOT_FOUND" }, { status: 404 });
    }

    // Toggle. deleteMany/create are both race-safe: a concurrent duplicate create
    // hits the unique (userId, wallpaperId) constraint and is treated as "already favorited".
    const removed = await db.wallpaperFavorite.deleteMany({ where: { userId: user.id, wallpaperId: id } });
    if (removed.count > 0) return NextResponse.json({ success: true, favorited: false });

    try {
      await db.wallpaperFavorite.create({ data: { userId: user.id, wallpaperId: id } });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
    }
    return NextResponse.json({ success: true, favorited: true });
  } catch (error) {
    console.error("Wallpaper favorite error:", error);
    return NextResponse.json({ success: false, error: "FAILED" }, { status: 500 });
  }
}
