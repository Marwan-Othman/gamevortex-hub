import { NextRequest, NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { getPlatformEnum } from "@/lib/platforms";
import { ensureCategoryIds } from "@/lib/categories";

export const dynamic = "force-dynamic";

async function requireSuperAdmin() {
  const { getOptionalUser } = await import("@/lib/auth");
  const user = await getOptionalUser();
  return user && user.role === "SUPER_ADMIN" ? user : null;
}

function blobUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && u.hostname.endsWith(".blob.vercel-storage.com");
  } catch { return false; }
}

function slug(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 100);
}

type GamePlatform = "PC"|"PLAYSTATION"|"XBOX"|"NINTENDO"|"ANDROID"|"IOS"|"MAC"|"LINUX"|"STEAM_DECK"|"WEB";

function platforms(value: unknown): GamePlatform[] {
  if (!Array.isArray(value)) return [];
  const out = new Set<GamePlatform>();
  for (const item of value) {
    if (typeof item === "string") {
      const p = getPlatformEnum(item);
      if (p) out.add(p);
    }
  }
  return Array.from(out);
}

function sourceStatus(value: unknown) {
  return value === "VERIFIED" || value === "PENDING_REVIEW" || value === "UNPUBLISHED" ||
    value === "NEEDS_SOURCE" || value === "OFFICIAL_SOURCE" || value === "LICENSED_FOR_DISTRIBUTION" ||
    value === "OPEN_SOURCE" || value === "FREEWARE_REDISTRIBUTABLE" ? value : "LICENSED_FOR_DISTRIBUTION";
}

export async function POST(request: NextRequest) {
  const uploaded: string[] = [];
  try {
    const user = await requireSuperAdmin();
    if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    if (!body || !Array.isArray(body.games) || body.games.length < 1 || body.games.length > 100) {
      return NextResponse.json({ success: false, error: "games must contain 1 to 100 items" }, { status: 400 });
    }

    const prepared = body.games.map((item: any, index: number) => {
      const titleAr = typeof item.titleAr === "string" ? item.titleAr.trim() : "";
      const titleEn = typeof item.titleEn === "string" ? item.titleEn.trim() : "";
      const gameSlug = typeof item.slug === "string" ? slug(item.slug) : "";
      const platformValues = platforms(item.platforms);
      const downloadSource = typeof item.downloadSource === "string" ? item.downloadSource : "";
      if (!titleAr || !titleEn || !gameSlug) throw new Error("INVALID_GAME_" + (index + 1));
      if (!platformValues.length) throw new Error("INVALID_PLATFORM_" + (index + 1));
      if (!blobUrl(downloadSource)) throw new Error("INVALID_DOWNLOAD_SOURCE_" + (index + 1));
      uploaded.push(downloadSource);

      const priceCents = typeof item.priceCents === "number" && Number.isFinite(item.priceCents)
        ? Math.max(0, Math.round(item.priceCents))
        : typeof item.price === "number" && Number.isFinite(item.price) ? Math.max(0, Math.round(item.price * 100)) : 0;
      const discountPercent = typeof item.discountPercent === "number" && Number.isFinite(item.discountPercent)
        ? Math.min(100, Math.max(0, Math.round(item.discountPercent)))
        : typeof item.discount === "number" && Number.isFinite(item.discount) ? Math.min(100, Math.max(0, Math.round(item.discount))) : 0;
      const categoryValues = Array.isArray(item.categoryIds)
        ? item.categoryIds.filter((v: unknown): v is string => typeof v === "string" && Boolean(v.trim()))
        : [];

      return {
        titleAr, titleEn, slug: gameSlug, platformValues, downloadSource,
        description: typeof item.descriptionAr === "string" && item.descriptionAr.trim() ? item.descriptionAr.trim()
          : typeof item.descriptionEn === "string" && item.descriptionEn.trim() ? item.descriptionEn.trim() : null,
        priceCents, discountPercent, categoryValues,
        sourceStatus: sourceStatus(item.sourceStatus),
        published: typeof item.published === "boolean" ? item.published : false,
        featured: typeof item.featured === "boolean" ? item.featured : false,
      };
    });

    const slugSet = new Set<string>();
    for (const item of prepared) {
      if (slugSet.has(item.slug)) return NextResponse.json({ success: false, error: "SLUG_DUPLICATE_IN_BATCH:" + item.slug }, { status: 409 });
      slugSet.add(item.slug);
    }

    const existing = await prisma.game.findMany({ where: { slug: { in: Array.from(slugSet) } }, select: { slug: true } });
    if (existing.length) return NextResponse.json({ success: false, error: "SLUG_ALREADY_EXISTS:" + existing.map((x: { slug: string }) => x.slug).join(",") }, { status: 409 });

    const allCategoryValues = Array.from(new Set(prepared.flatMap((x) => x.categoryValues)));
    const ensuredCategoryIds = await ensureCategoryIds(prisma, allCategoryValues);
    const categorySet = new Set(ensuredCategoryIds);

    const games = await prisma.$transaction(async (tx) => {
      const created = [];
      for (const item of prepared) {
        const game = await tx.game.create({
          data: {
            titleAr: item.titleAr, titleEn: item.titleEn, slug: item.slug, description: item.description,
            genre: null, platform: item.platformValues.join(","), priceCents: item.priceCents,
            discountPercent: item.discountPercent, coverUrl: null, officialUrl: null,
            downloadSource: item.downloadSource, sourceStatus: item.sourceStatus,
            published: item.published, featured: item.featured,
            gamePlatforms: { create: item.platformValues.map((platform: GamePlatform) => ({ platform })) },
            gameCategories: categorySet.size ? { create: Array.from(categorySet).map((categoryId) => ({ categoryId })) } : undefined,
          },
        });
        await tx.auditLog.create({
          data: {
            actorUserId: user.id, action: "GAME_CREATED_WITH_FILE_UPLOAD", entityType: "Game", entityId: game.id,
            metadata: { slug: game.slug, published: game.published, sourceStatus: game.sourceStatus, bulkUpload: true },
          },
        });
        created.push(game);
      }
      return created;
    });

    return NextResponse.json({ success: true, count: games.length, data: games }, { status: 201 });
  } catch (error) {
    console.error("POST /api/admin/games/bulk error:", error);
    for (const url of Array.from(new Set(uploaded))) { try { await del(url); } catch {} }
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Failed to create games" }, { status: 500 });
  }
}
