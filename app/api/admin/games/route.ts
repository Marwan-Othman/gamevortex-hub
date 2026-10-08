import { NextRequest, NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { getPlatformEnum, normalizePlatform } from "@/lib/platforms";
import { ensureCategoryIds } from "@/lib/categories";

export const dynamic = "force-dynamic";

async function requireSuperAdmin() {
  const { getOptionalUser } = await import("@/lib/auth");
  const user = await getOptionalUser();
  if (!user || user.role !== "SUPER_ADMIN") return null;
  return user;
}

function normalizePlatforms(value: unknown) {
  if (!Array.isArray(value)) return [];
  const result = new Set<"PC"|"PLAYSTATION"|"XBOX"|"NINTENDO"|"ANDROID"|"IOS"|"MAC"|"LINUX"|"STEAM_DECK"|"WEB">();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const platform = getPlatformEnum(item);
    if (platform) result.add(platform);
  }
  return Array.from(result);
}

function normalizeSourceStatus(value: unknown) {
  if (
    value === "VERIFIED" ||
    value === "PENDING_REVIEW" ||
    value === "UNPUBLISHED" ||
    value === "NEEDS_SOURCE" ||
    value === "OFFICIAL_SOURCE" ||
    value === "LICENSED_FOR_DISTRIBUTION" ||
    value === "OPEN_SOURCE" ||
    value === "FREEWARE_REDISTRIBUTABLE"
  ) return value;
  return "NEEDS_SOURCE" as const;
}

function isVercelBlobUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.endsWith(".blob.vercel-storage.com");
  } catch {
    return false;
  }
}

function normalizeSlug(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 100);
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireSuperAdmin();
    if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search")?.trim() ?? "";
    const platformParam = searchParams.get("platform")?.trim() ?? "";
    const platform = normalizePlatform(platformParam);
    const where: any = {};

    if (search) {
      where.OR = [
        { titleAr: { contains: search, mode: "insensitive" } },
        { titleEn: { contains: search, mode: "insensitive" } },
        { slug: { contains: search, mode: "insensitive" } },
      ];
    }
    if (platform) where.gamePlatforms = { some: { platform: platform.toUpperCase() } };

    const games = await prisma.game.findMany({
      where,
      include: { gamePlatforms: true, gameCategories: { include: { category: true } } },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ success: true, data: games });
  } catch (error) {
    console.error("GET /api/admin/games error:", error);
    return NextResponse.json({ success: false, error: "Failed to load games" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  let uploadedGameUrl: string | null = null;
  let uploadedCoverUrl: string | null = null;

  try {
    const user = await requireSuperAdmin();
    if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const {
      titleAr, titleEn, slug, descriptionAr, descriptionEn, genre, category, platforms,
      platform, price, priceCents, discount, discountPercent, coverUrl, downloadSource,
      sourceStatus, published, featured,
    } = body;

    if (typeof titleAr !== "string" || !titleAr.trim() || typeof titleEn !== "string" || !titleEn.trim() || typeof slug !== "string" || !slug.trim()) {
      return NextResponse.json({ success: false, error: "titleAr, titleEn and slug are required" }, { status: 400 });
    }

    const normalizedSlug = normalizeSlug(slug);
    if (!normalizedSlug) return NextResponse.json({ success: false, error: "Invalid slug" }, { status: 400 });

    const platformValues = normalizePlatforms(Array.isArray(platforms) ? platforms : platform ? [platform] : []);
    if (!platformValues.length) return NextResponse.json({ success: false, error: "At least one platform is required" }, { status: 400 });

    if (typeof downloadSource !== "string" || !isVercelBlobUrl(downloadSource)) {
      return NextResponse.json({ success: false, error: "A GameVortex Blob game file is required" }, { status: 400 });
    }
    uploadedGameUrl = downloadSource;

    if (coverUrl !== undefined && coverUrl !== null && coverUrl !== "") {
      if (typeof coverUrl !== "string" || !isVercelBlobUrl(coverUrl)) {
        return NextResponse.json({ success: false, error: "Cover must be stored in GameVortex Blob" }, { status: 400 });
      }
      uploadedCoverUrl = coverUrl;
    }

    const existing = await prisma.game.findUnique({ where: { slug: normalizedSlug }, select: { id: true } });
    if (existing) return NextResponse.json({ success: false, error: "SLUG_ALREADY_EXISTS" }, { status: 409 });

    const normalizedSourceStatus = normalizeSourceStatus(sourceStatus);
    const description =
      typeof descriptionAr === "string" && descriptionAr.trim()
        ? descriptionAr.trim()
        : typeof descriptionEn === "string" && descriptionEn.trim()
          ? descriptionEn.trim()
          : null;

    const categoryValues = Array.isArray(body.categoryIds)
      ? body.categoryIds.filter((value: unknown): value is string => typeof value === "string" && value.trim())
      : typeof category === "string" && category.trim() ? [category.trim()]
        : typeof genre === "string" && genre.trim() ? [genre.trim()] : [];
    const categoryIds = await ensureCategoryIds(prisma, categoryValues);

    const normalizedGenre =
      typeof genre === "string" && genre.trim() ? genre.trim()
        : typeof category === "string" && category.trim() ? category.trim() : null;

    const normalizedPriceCents =
      typeof priceCents === "number" && Number.isFinite(priceCents) ? Math.max(0, Math.round(priceCents))
        : typeof price === "number" && Number.isFinite(price) ? Math.max(0, Math.round(price * 100)) : 0;

    const normalizedDiscountPercent =
      typeof discountPercent === "number" && Number.isFinite(discountPercent)
        ? Math.min(100, Math.max(0, Math.round(discountPercent)))
        : typeof discount === "number" && Number.isFinite(discount)
          ? Math.min(100, Math.max(0, Math.round(discount))) : 0;

    const game = await prisma.game.create({
      data: {
        titleAr: titleAr.trim(),
        titleEn: titleEn.trim(),
        slug: normalizedSlug,
        description,
        genre: normalizedGenre,
        platform: platformValues.join(","),
        priceCents: normalizedPriceCents,
        discountPercent: normalizedDiscountPercent,
        coverUrl: uploadedCoverUrl,
        officialUrl: null,
        downloadSource: uploadedGameUrl,
        sourceStatus: normalizedSourceStatus,
        published: typeof published === "boolean" ? published : false,
        featured: typeof featured === "boolean" ? featured : false,
        gamePlatforms: { create: platformValues.map((item) => ({ platform: item })) },
        gameCategories: categoryIds.length ? { create: categoryIds.map((categoryId) => ({ categoryId })) } : undefined,
      },
      include: { gamePlatforms: true },
    });

    await prisma.auditLog.create({
      data: {
        actorUserId: user.id,
        action: "GAME_CREATED_WITH_FILE_UPLOAD",
        entityType: "Game",
        entityId: game.id,
        metadata: {
          slug: game.slug,
          published: game.published,
          sourceStatus: game.sourceStatus,
          hasCover: Boolean(game.coverUrl),
        },
      },
    });

    return NextResponse.json({ success: true, data: game }, { status: 201 });
  } catch (error) {
    console.error("POST /api/admin/games error:", error);

    if (uploadedGameUrl) {
      try { await del(uploadedGameUrl); } catch (cleanupError) {
        console.error("Failed to clean up uploaded game Blob:", cleanupError);
      }
    }
    if (uploadedCoverUrl) {
      try { await del(uploadedCoverUrl); } catch (cleanupError) {
        console.error("Failed to clean up uploaded cover Blob:", cleanupError);
      }
    }

    return NextResponse.json({ success: false, error: "Failed to create game" }, { status: 500 });
  }
}
