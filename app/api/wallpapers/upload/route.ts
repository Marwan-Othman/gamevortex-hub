import { NextRequest, NextResponse } from "next/server";
import { WallpaperMediaType, WallpaperModerationStatus } from "@prisma/client";
import { db } from "@/lib/prisma";
import { getOptionalUser } from "@/lib/auth";
import { isHttpsUrl, normalizeWallpaperTags, normalizeWallpaperSlug } from "@/lib/wallpapers";
import { validateWallpaperMedia } from "@/lib/wallpaper-moderation";
import { guardMutation } from "@/lib/api";

export const dynamic = "force-dynamic";

const TYPES = new Set(["MOBILE", "DESKTOP"]);
const MAX_BODY = 20_000;

export async function POST(request: NextRequest) {
  const guard = await guardMutation(request, "wallpapers-upload");
  if (guard) return guard;
  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (user.role !== "SUPER_ADMIN") return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });
  if (request.headers.get("content-length") && Number(request.headers.get("content-length")) > MAX_BODY) {
    return NextResponse.json({ success: false, error: "Payload too large" }, { status: 413 });
  }

  try {
    const body = await request.json();
    const titleAr = typeof body.titleAr === "string" ? body.titleAr.trim().slice(0, 160) : "";
    const titleEn = typeof body.titleEn === "string" ? body.titleEn.trim().slice(0, 160) : "";
    const imageUrl = typeof body.imageUrl === "string" ? body.imageUrl.trim() : "";
    const type = TYPES.has(body.type) ? body.type : null;
    const mediaType = body.mediaType === "VIDEO" ? WallpaperMediaType.VIDEO : WallpaperMediaType.IMAGE;
    if (!titleAr || !titleEn || !imageUrl || !type) return NextResponse.json({ success: false, error: "titleAr, titleEn, imageUrl and type are required" }, { status: 400 });

    validateWallpaperMedia({
      mediaType,
      imageUrl,
      mediaUrl: typeof body.mediaUrl === "string" ? body.mediaUrl.trim() : null,
      durationSeconds: body.durationSeconds == null ? null : Number(body.durationSeconds),
    });

    const slugBase = normalizeWallpaperSlug(body.slug, titleEn);
    const slug = `${slugBase}-${user.id.slice(-8)}`.slice(0, 160);
    const tags = normalizeWallpaperTags(body.tags);

    const duplicate = await db.wallpaper.findUnique({ where: { slug } });
    if (duplicate) return NextResponse.json({ success: false, error: "A similar submission already exists" }, { status: 409 });

    const wallpaper = await db.wallpaper.create({
      data: {
        titleAr,
        titleEn,
        slug,
        descriptionAr: typeof body.descriptionAr === "string" ? body.descriptionAr.trim().slice(0, 5000) : null,
        descriptionEn: typeof body.descriptionEn === "string" ? body.descriptionEn.trim().slice(0, 5000) : null,
        imageUrl,
        thumbnailUrl: typeof body.thumbnailUrl === "string" && isHttpsUrl(body.thumbnailUrl) ? body.thumbnailUrl.trim() : null,
        mediaUrl: mediaType === WallpaperMediaType.VIDEO ? body.mediaUrl.trim() : null,
        mediaType,
        durationSeconds: mediaType === WallpaperMediaType.VIDEO ? Number(body.durationSeconds) : null,
        type,
        orientation: typeof body.orientation === "string" ? body.orientation.slice(0, 20) : "LANDSCAPE",
        category: typeof body.category === "string" ? body.category.toUpperCase().slice(0, 40) : "OTHER",
        tags,
        width: Number.isInteger(body.width) ? body.width : null,
        height: Number.isInteger(body.height) ? body.height : null,
        resolution: typeof body.resolution === "string" ? body.resolution.slice(0, 40) : null,
        sourceUrl: typeof body.sourceUrl === "string" && isHttpsUrl(body.sourceUrl) ? body.sourceUrl.trim() : null,
        sourceProvider: typeof body.sourceProvider === "string" ? body.sourceProvider.trim().slice(0, 160) : null,
        licenseUrl: typeof body.licenseUrl === "string" && isHttpsUrl(body.licenseUrl) ? body.licenseUrl.trim() : null,
        licenseStatus: typeof body.licenseStatus === "string" ? body.licenseStatus.trim().slice(0, 120) : null,
        attribution: typeof body.attribution === "string" ? body.attribution.trim().slice(0, 1000) : null,
        sourceStatus: "PENDING_REVIEW",
        isVip: false,
        published: false,
        featured: false,
        moderationStatus: WallpaperModerationStatus.PENDING,
        uploadedById: user.id,
      },
      select: { id: true, moderationStatus: true, published: true },
    });

    return NextResponse.json({ success: true, data: wallpaper }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
