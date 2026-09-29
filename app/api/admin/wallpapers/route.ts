import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOptionalUser } from "@/lib/auth";
import { isHttpsUrl, normalizeWallpaperTags, normalizeWallpaperSlug, canPublishWallpaper, normalizeWallpaperSourceStatus } from "@/lib/wallpapers";

export const dynamic = "force-dynamic";

async function requireSuperAdmin() {
  const user = await getOptionalUser();
  return user?.role === "SUPER_ADMIN" ? user : null;
}

const TYPES = ["MOBILE", "DESKTOP"] as const;
const CATEGORIES = ["GAMING", "ANIME", "CYBERPUNK", "CARS", "SPORTS", "NATURE", "SPACE", "FANTASY", "ABSTRACT", "ARABIC", "ISLAMIC", "TECHNOLOGY", "MINIMAL", "AI", "NEON", "GAMEVORTEX", "OTHER"] as const;

function cleanOptional(value: unknown, max = 5000) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

export async function GET(request: NextRequest) {
  const user = await requireSuperAdmin();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const type = TYPES.includes(searchParams.get("type") as never) ? searchParams.get("type") as "MOBILE" | "DESKTOP" : undefined;
  const isVip = searchParams.get("vip") === "true" ? true : searchParams.get("vip") === "false" ? false : undefined;
  const wallpapers = await prisma.wallpaper.findMany({ where: { ...(type ? { type } : {}), ...(isVip !== undefined ? { isVip } : {}) }, orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }], take: 500 });
  return NextResponse.json({ success: true, data: wallpapers });
}

export async function POST(request: NextRequest) {
  const user = await requireSuperAdmin();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    const titleAr = cleanOptional(body.titleAr, 160);
    const titleEn = cleanOptional(body.titleEn, 160);
    const imageUrl = cleanOptional(body.imageUrl, 2000);
    if (!titleAr || !titleEn || !imageUrl) return NextResponse.json({ success: false, error: "titleAr, titleEn and imageUrl are required" }, { status: 400 });
    if (!isHttpsUrl(imageUrl)) return NextResponse.json({ success: false, error: "imageUrl must be HTTPS" }, { status: 400 });

    const type = TYPES.includes(body.type) ? body.type : null;
    if (!type) return NextResponse.json({ success: false, error: "type must be MOBILE or DESKTOP" }, { status: 400 });
    const category = CATEGORIES.includes(body.category) ? body.category : "OTHER";
    const sourceUrl = cleanOptional(body.sourceUrl, 2000);
    const licenseUrl = cleanOptional(body.licenseUrl, 2000);
    const downloadUrl = cleanOptional(body.downloadUrl, 2000);
    const thumbnailUrl = cleanOptional(body.thumbnailUrl, 2000);
    for (const [name, value] of [["sourceUrl", sourceUrl], ["licenseUrl", licenseUrl], ["downloadUrl", downloadUrl], ["thumbnailUrl", thumbnailUrl]] as const) {
      if (value && !isHttpsUrl(value)) return NextResponse.json({ success: false, error: `${name} must be HTTPS` }, { status: 400 });
    }

    const sourceStatus = normalizeWallpaperSourceStatus(body.sourceStatus);
    const published = body.published === true;
    const verification = canPublishWallpaper({ imageUrl, sourceUrl, licenseUrl, sourceStatus });
    if (published && !verification.valid) return NextResponse.json({ success: false, error: `Cannot publish: ${verification.reason}` }, { status: 400 });

    const baseSlug = normalizeWallpaperSlug(body.slug, titleEn);
    let slug = baseSlug;
    for (let i = 2; i < 100; i++) {
      const exists = await prisma.wallpaper.findUnique({ where: { slug }, select: { id: true } });
      if (!exists) break;
      slug = `${baseSlug}-${i}`;
    }

    const wallpaper = await prisma.wallpaper.create({ data: {
      titleAr, titleEn, slug,
      descriptionAr: cleanOptional(body.descriptionAr), descriptionEn: cleanOptional(body.descriptionEn),
      imageUrl, thumbnailUrl, downloadUrl, sourceUrl, sourceProvider: cleanOptional(body.sourceProvider, 160),
      licenseUrl, licenseStatus: cleanOptional(body.licenseStatus, 120), attribution: cleanOptional(body.attribution, 1000), sourceStatus,
      type, orientation: cleanOptional(body.orientation, 30) || (type === "MOBILE" ? "PORTRAIT" : "LANDSCAPE"), deviceType: cleanOptional(body.deviceType, 30) || (type === "MOBILE" ? "MOBILE" : "DESKTOP"),
      category, tags: normalizeWallpaperTags(body.tags), width: typeof body.width === "number" ? Math.round(body.width) : null, height: typeof body.height === "number" ? Math.round(body.height) : null, resolution: cleanOptional(body.resolution, 60),
      isVip: body.isVip === true, published, featured: body.featured === true, sortOrder: Number.isFinite(body.sortOrder) ? Math.round(body.sortOrder) : 0, uploadedById: user.id,
    } });
    return NextResponse.json({ success: true, data: wallpaper }, { status: 201 });
  } catch (error) {
    console.error("POST /api/admin/wallpapers error:", error);
    return NextResponse.json({ success: false, error: "Failed to create wallpaper" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const user = await requireSuperAdmin();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  try {
    const body = await request.json();
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) return NextResponse.json({ success: false, error: "Wallpaper id is required" }, { status: 400 });
    const current = await prisma.wallpaper.findUnique({ where: { id } });
    if (!current) return NextResponse.json({ success: false, error: "Wallpaper not found" }, { status: 404 });

    const nextPublished = typeof body.published === "boolean" ? body.published : current.published;
    const nextImage = typeof body.imageUrl === "string" ? body.imageUrl.trim() : current.imageUrl;
    const nextSource = typeof body.sourceUrl === "string" ? body.sourceUrl.trim() : current.sourceUrl;
    const nextLicense = typeof body.licenseUrl === "string" ? body.licenseUrl.trim() : current.licenseUrl;
    const nextStatus = body.sourceStatus !== undefined ? normalizeWallpaperSourceStatus(body.sourceStatus) : current.sourceStatus;
    if (!isHttpsUrl(nextImage) || (nextSource && !isHttpsUrl(nextSource)) || (nextLicense && !isHttpsUrl(nextLicense))) return NextResponse.json({ success: false, error: "All URLs must be HTTPS" }, { status: 400 });
    if (nextPublished) {
      const verification = canPublishWallpaper({ imageUrl: nextImage, sourceUrl: nextSource, licenseUrl: nextLicense, sourceStatus: nextStatus });
      if (!verification.valid) return NextResponse.json({ success: false, error: `Cannot publish: ${verification.reason}` }, { status: 400 });
    }

    const data: Record<string, unknown> = { published: nextPublished };
    for (const key of ["featured", "isVip"] as const) if (typeof body[key] === "boolean") data[key] = body[key];
    if (typeof body.titleAr === "string") data.titleAr = body.titleAr.trim().slice(0, 160);
    if (typeof body.titleEn === "string") data.titleEn = body.titleEn.trim().slice(0, 160);
    if (typeof body.imageUrl === "string") data.imageUrl = nextImage;
    if (typeof body.downloadUrl === "string" && body.downloadUrl.trim()) data.downloadUrl = isHttpsUrl(body.downloadUrl) ? body.downloadUrl.trim() : undefined;
    if (body.tags !== undefined) data.tags = normalizeWallpaperTags(body.tags);
    if (typeof body.category === "string" && CATEGORIES.includes(body.category as never)) data.category = body.category;
    if (body.sourceStatus !== undefined) data.sourceStatus = nextStatus;
    if (typeof body.sourceUrl === "string") data.sourceUrl = nextSource || null;
    if (typeof body.licenseUrl === "string") data.licenseUrl = nextLicense || null;
    if (typeof body.attribution === "string") data.attribution = body.attribution.trim().slice(0, 1000) || null;
    if (typeof body.thumbnailUrl === "string") data.thumbnailUrl = body.thumbnailUrl.trim() || null;
    if (typeof body.resolution === "string") data.resolution = body.resolution.trim().slice(0, 60) || null;
    if (typeof body.sortOrder === "number" && Number.isFinite(body.sortOrder)) data.sortOrder = Math.round(body.sortOrder);

    const wallpaper = await prisma.wallpaper.update({ where: { id }, data });
    return NextResponse.json({ success: true, data: wallpaper });
  } catch (error) {
    console.error("PATCH /api/admin/wallpapers error:", error);
    return NextResponse.json({ success: false, error: "Failed to update wallpaper" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const user = await requireSuperAdmin();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  try {
    const id = new URL(request.url).searchParams.get("id")?.trim();
    if (!id) return NextResponse.json({ success: false, error: "Wallpaper id is required" }, { status: 400 });
    await prisma.wallpaper.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/admin/wallpapers error:", error);
    return NextResponse.json({ success: false, error: "Failed to delete wallpaper" }, { status: 500 });
  }
}
