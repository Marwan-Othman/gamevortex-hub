import { NextRequest, NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { getPlatformEnum, normalizePlatform } from "@/lib/platforms";
import { ensureCategoryIds } from "@/lib/categories";

export const dynamic = "force-dynamic";

const MAX_BULK_GAMES = 100;

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
    value === "VERIFIED" || value === "PENDING_REVIEW" || value === "UNPUBLISHED" ||
    value === "NEEDS_SOURCE" || value === "OFFICIAL_SOURCE" ||
    value === "LICENSED_FOR_DISTRIBUTION" || value === "OPEN_SOURCE" ||
    value === "FREEWARE_REDISTRIBUTABLE"
  ) return value;
  return "LICENSED_FOR_DISTRIBUTION" as const;
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
  return value.trim().toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
}

function normalizeNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export async function POST(request: NextRequest) {
  let uploadedUrls: string[] = [];

  try {
    const user = await requireSuperAdmin();
    if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    if (!Array.isArray(body?.games) || body.games.length < 1 || body.games.length > MAX_BULK_GAMES) {
      return NextResponse.json({
        success: false,
        error: `Bulk upload supports 1 to ${MAX_BULK_GAMES} games per batch`,
      }, { status: 400 });
    }

    const rawGames = body.games as unknown[];
    const normalizedGames: Array<{
      titleAr: string;
      titleEn: string;
      slug: string;
      description: string | null;
      genre: string | null;
      platforms: ReturnType<typeof normalizePlatforms>;
      categoryIds: string[];
      priceCents: number;
      discountPercent: number;
      downloadSource: string;
      sourceStatus: ReturnType<typeof normalizeSourceStatus>;
      published: boolean;
      featured: boolean;
    }> = [];

    const seenSlugs = new Set<string>();

    for (let index = 0; index < rawGames.length; index += 1) {
      const item = rawGames[index];
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return NextResponse.json({ success: false, error: `Invalid game at position ${index + 1}` }, { status: 400 });
      }

      const game = item as Record<string, unknown>;
      if (typeof game.titleAr !== "string" || !game.titleAr.trim() ||
          typeof game.titleEn !== "string" || !game.titleEn.trim() ||
          typeof game.slug !== "string" || !game.slug.trim()) {
        return NextResponse.json({ success: false, error: `Missing title or slug at position ${index + 1}` }, { status: 400 });
      }

      const slug = normalizeSlug(game.slug);
      if (!slug) return NextResponse.json({ success: false, error: `Invalid slug at position ${index + 1}` }, { status: 400 });
      if (seenSlugs.has(slug)) {
        return NextResponse.json({ success: false, error: `DUPLICATE_SLUG_IN_BATCH: ${slug}` }, { status: 409 });
      }
      seenSlugs.add(slug);

      if (typeof game.downloadSource !== "string" || !isVercelBlobUrl(game.downloadSource)) {
        return NextResponse.json({ success: false, error: `Invalid uploaded file at position ${index + 1}` }, { status: 400 });
      }
      uploadedUrls.push(game.downloadSource);

      const platforms = normalizePlatforms(game.platforms);
      if (!platforms.length) {
        return NextResponse.json({ success: false, error: `At least one platform is required at position ${index + 1}` }, { status: 400 });
      }

      const categoryValues = Array.isArray(game.categoryIds)
        ? game.categoryIds.filter((value: unknown): value is string => typeof value === "string" && Boolean(value.trim()))
        : [];
      const categoryIds = await ensureCategoryIds(prisma, categoryValues);

      const price = Math.max(0, normalizeNumber(game.price, 0));
      const discount = Math.min(100, Math.max(0, normalizeNumber(game.discount, 0)));

      normalizedGames.push({
        titleAr: game.titleAr.trim().slice(0, 160),
        titleEn: game.titleEn.trim().slice(0, 160),
        slug,
        description: typeof game.descriptionAr === "string" && game.descriptionAr.trim()
          ? game.descriptionAr.trim().slice(0, 4000)
          : null,
        genre: typeof game.genre === "string" && game.genre.trim() ? game.genre.trim().slice(0, 160) : null,
        platforms,
        categoryIds,
        priceCents: Math.round(price * 100),
        discountPercent: Math.round(discount),
        downloadSource: game.downloadSource,
        sourceStatus: normalizeSourceStatus(game.sourceStatus),
        published: typeof game.published === "boolean" ? game.published : false,
        featured: typeof game.featured === "boolean" ? game.featured : false,
      });
    }

    const existing = await prisma.game.findMany({
      where: { slug: { in: normalizedGames.map((game) => game.slug) } },
      select: { slug: true },
    });
    if (existing.length) {
      return NextResponse.json({
        success: false,
        error: `SLUG_ALREADY_EXISTS: ${existing.map((game) => game.slug).join(", ")}`,
      }, { status: 409 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const createdGames = [];

      for (const item of normalizedGames) {
        const game = await tx.game.create({
          data: {
            titleAr: item.titleAr,
            titleEn: item.titleEn,
            slug: item.slug,
            description: item.description,
            genre: item.genre,
            platform: item.platforms.join(","),
            priceCents: item.priceCents,
            discountPercent: item.discountPercent,
            coverUrl: null,
            officialUrl: null,
            downloadSource: item.downloadSource,
            sourceStatus: item.sourceStatus,
            published: item.published,
            featured: item.featured,
            gamePlatforms: { create: item.platforms.map((platform) => ({ platform })) },
            gameCategories: item.categoryIds.length
              ? { create: item.categoryIds.map((categoryId) => ({ categoryId })) }
              : undefined,
          },
          include: { gamePlatforms: true },
        });

        await tx.auditLog.create({
          data: {
            actorUserId: user.id,
            action: "GAME_CREATED_WITH_FILE_UPLOAD",
            entityType: "Game",
            entityId: game.id,
            metadata: {
              slug: game.slug,
              published: game.published,
              sourceStatus: game.sourceStatus,
              bulkUpload: true,
              batchSize: normalizedGames.length,
            },
          },
        });

        createdGames.push(game);
      }

      return createdGames;
    });

    return NextResponse.json({
      success: true,
      count: result.length,
      data: result,
    }, { status: 201 });
  } catch (error) {
    console.error("POST /api/admin/games/bulk error:", error instanceof Error ? error.message : "UNKNOWN");

    for (const url of uploadedUrls) {
      try { await del(url); } catch (cleanupError) {
        console.error("Failed to clean up bulk uploaded Blob:", cleanupError);
      }
    }

    return NextResponse.json({ success: false, error: "Failed to create bulk games" }, { status: 500 });
  }
}
