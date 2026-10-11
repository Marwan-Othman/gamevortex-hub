import { NextRequest, NextResponse } from "next/server";
import { WallpaperModerationStatus } from "@prisma/client";
import { db } from "@/lib/prisma";
import { getOptionalUser } from "@/lib/auth";
import { creditPoints } from "@/lib/points";
import { guardMutation, guardRead, publicErrorCode } from "@/lib/api";
import { logSystemError } from "@/lib/observability";

export const dynamic = "force-dynamic";

async function requireSuperAdmin() {
  const user = await getOptionalUser();
  return user?.role === "SUPER_ADMIN" ? user : null;
}

export async function GET(request: NextRequest) {
  const blocked = await guardRead(request, "admin:wallpapers:moderation", 60);
  if (blocked) return blocked;
  const admin = await requireSuperAdmin();
  if (!admin) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  try {
    const items = await db.wallpaper.findMany({
      where: { moderationStatus: WallpaperModerationStatus.PENDING },
      orderBy: { createdAt: "asc" },
      take: 200,
      select: { id: true, titleAr: true, titleEn: true, imageUrl: true, mediaUrl: true, mediaType: true, uploadedById: true, createdAt: true, sourceUrl: true, licenseUrl: true, attribution: true },
    });
    return NextResponse.json({ success: true, data: items });
  } catch (error) {
    console.error("GET /api/admin/wallpapers/moderation", error);
    return NextResponse.json({ success: false, error: "MODERATION_LOAD_FAILED" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  // Same CSRF-origin + rate-limit guard every other admin mutation uses.
  const blocked = await guardMutation(request, "admin:wallpapers:moderation", 30);
  if (blocked) return blocked;
  const admin = await requireSuperAdmin();
  if (!admin) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ success: false, error: "INVALID_BODY" }, { status: 400 });
    const id = typeof body.id === "string" ? body.id.slice(0, 100) : "";
    const decision = body.decision === "APPROVED" ? WallpaperModerationStatus.APPROVED : body.decision === "REJECTED" ? WallpaperModerationStatus.REJECTED : null;
    if (!id || !decision) return NextResponse.json({ success: false, error: "INVALID_REQUEST" }, { status: 400 });

    const result = await db.$transaction(async (tx) => {
      const wallpaper = await tx.wallpaper.findUnique({ where: { id }, select: { id: true, uploadedById: true, moderationStatus: true } });
      if (!wallpaper) throw new Error("WALLPAPER_NOT_FOUND");
      if (wallpaper.moderationStatus !== WallpaperModerationStatus.PENDING) throw new Error("ALREADY_REVIEWED");
      const updated = await tx.wallpaper.update({ where: { id }, data: { moderationStatus: decision, published: decision === WallpaperModerationStatus.APPROVED, rejectionReason: decision === WallpaperModerationStatus.REJECTED ? String(body.reason || "Rejected by moderation").slice(0, 500) : null, reviewedById: admin.id, reviewedAt: new Date() }, select: { id: true, moderationStatus: true, published: true, uploadedById: true } });
      return updated;
    });

    let rewardPending = false;
    if (decision === WallpaperModerationStatus.APPROVED && result.uploadedById) {
      // The approval is already committed. A failed reward must not turn it into an
      // error (a retry would only see ALREADY_REVIEWED); the idempotency key makes a
      // later re-credit safe, so log it and report the pending reward.
      try {
        await creditPoints({ userId: result.uploadedById, amount: 25, reason: "Approved GameVortex wallpaper contribution", sourceId: result.id, idempotencyKey: `wallpaper-approved:${result.id}`, metadata: { type: "WALLPAPER_APPROVAL" } });
      } catch (error) {
        rewardPending = true;
        await logSystemError("wallpapers:approval-reward", error, { userId: admin.id, metadata: { wallpaperId: result.id } });
      }
    }

    return NextResponse.json({ success: true, data: result, rewardPending });
  } catch (error) {
    const code = publicErrorCode(error, "MODERATION_FAILED");
    const status = code === "WALLPAPER_NOT_FOUND" ? 404 : code === "ALREADY_REVIEWED" ? 409 : code === "MODERATION_FAILED" ? 500 : 400;
    return NextResponse.json({ success: false, error: code }, { status });
  }
}
