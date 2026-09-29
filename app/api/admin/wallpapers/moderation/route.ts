import { NextRequest, NextResponse } from "next/server";
import { WallpaperModerationStatus } from "@prisma/client";
import { db } from "@/lib/prisma";
import { getOptionalUser } from "@/lib/auth";
import { creditPoints } from "@/lib/points";

async function requireSuperAdmin() {
  const user = await getOptionalUser();
  return user?.role === "SUPER_ADMIN" ? user : null;
}

export async function GET() {
  const admin = await requireSuperAdmin();
  if (!admin) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  const items = await db.wallpaper.findMany({
    where: { moderationStatus: WallpaperModerationStatus.PENDING },
    orderBy: { createdAt: "asc" },
    take: 200,
    select: { id: true, titleAr: true, titleEn: true, imageUrl: true, mediaUrl: true, mediaType: true, uploadedById: true, createdAt: true, sourceUrl: true, licenseUrl: true, attribution: true },
  });
  return NextResponse.json({ success: true, data: items });
}

export async function PATCH(request: NextRequest) {
  const admin = await requireSuperAdmin();
  if (!admin) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    const id = typeof body.id === "string" ? body.id : "";
    const decision = body.decision === "APPROVED" ? WallpaperModerationStatus.APPROVED : body.decision === "REJECTED" ? WallpaperModerationStatus.REJECTED : null;
    if (!id || !decision) return NextResponse.json({ success: false, error: "id and decision are required" }, { status: 400 });

    const result = await db.$transaction(async (tx) => {
      const wallpaper = await tx.wallpaper.findUnique({ where: { id }, select: { id: true, uploadedById: true, moderationStatus: true } });
      if (!wallpaper) throw new Error("WALLPAPER_NOT_FOUND");
      if (wallpaper.moderationStatus !== WallpaperModerationStatus.PENDING) throw new Error("ALREADY_REVIEWED");
      const updated = await tx.wallpaper.update({ where: { id }, data: { moderationStatus: decision, published: decision === WallpaperModerationStatus.APPROVED, rejectionReason: decision === WallpaperModerationStatus.REJECTED ? String(body.reason || "Rejected by moderation").slice(0, 500) : null, reviewedById: admin.id, reviewedAt: new Date() }, select: { id: true, moderationStatus: true, published: true, uploadedById: true } });
      return updated;
    });

    if (decision === WallpaperModerationStatus.APPROVED && result.uploadedById) {
      await creditPoints({ userId: result.uploadedById, amount: 25, reason: "Approved GameVortex wallpaper contribution", sourceId: result.id, idempotencyKey: `wallpaper-approved:${result.id}`, metadata: { type: "WALLPAPER_APPROVAL" } });
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Moderation failed" }, { status: 400 });
  }
}
