import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { guardMutation, guardRead } from "@/lib/api";
import { requireOwner } from "@/lib/auth";
import { ensureCategoryIds } from "@/lib/categories";
import { getPlatformEnum } from "@/lib/platforms";
import {
  DEFAULT_UPLOAD_SOURCE_STATUS,
  canonicalBlobUrl,
  normalizeUploadSourceStatus,
} from "@/lib/game-upload-shared";
import { importRemoteContentFile } from "@/lib/content-source-server";
import { safeCleanupBlobs } from "@/lib/game-upload-server";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const PLATFORM_VALUES = ["PC","PLAYSTATION","XBOX","NINTENDO","ANDROID","IOS","MAC","LINUX","STEAM_DECK","WEB"] as const;
type ContentType = "GAME" | "APP" | "MOD";

function clean(value: unknown, max = 4000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function platforms(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === "string")
    .map(getPlatformEnum)
    .filter((item): item is NonNullable<ReturnType<typeof getPlatformEnum>> => Boolean(item)))];
}

function normalizeSlug(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 100);
}

function parseType(value: unknown): ContentType | null {
  return value === "GAME" || value === "APP" || value === "MOD" ? value : null;
}

async function uniqueSlug(slug: string) {
  const [game, app, mod] = await Promise.all([
    prisma.game.findUnique({ where: { slug }, select: { id: true } }),
    prisma.app.findUnique({ where: { slug }, select: { id: true } }),
    prisma.mod.findUnique({ where: { slug }, select: { id: true } }),
  ]);
  return !game && !app && !mod;
}

export async function GET(request: NextRequest) {
  const blocked = await guardRead(request, "admin:content", 60);
  if (blocked) return blocked;
  try {
    await requireOwner();
    const [games, apps, mods, categories] = await Promise.all([
      prisma.game.findMany({
        orderBy: { updatedAt: "desc" }, take: 150,
        select: {
          id: true, slug: true, titleAr: true, titleEn: true, published: true,
          sourceStatus: true, downloadSource: true, coverUrl: true,
          gamePlatforms: { select: { platform: true } },
          images: { orderBy: { sortOrder: "asc" }, select: { id: true, url: true, sortOrder: true } },
        },
      }),
      prisma.app.findMany({
        orderBy: { updatedAt: "desc" }, take: 150,
        select: {
          id: true, slug: true, nameAr: true, nameEn: true, published: true,
          sourceStatus: true, downloadSource: true, coverUrl: true, iconUrl: true,
          appPlatforms: { select: { platform: true } },
          images: { orderBy: { sortOrder: "asc" }, select: { id: true, url: true, sortOrder: true } },
        },
      }),
      prisma.mod.findMany({
        orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }], take: 150,
        select: { id: true, slug: true, titleAr: true, titleEn: true, published: true, sourceStatus: true, platform: true, gameId: true, imageUrl: true },
      }),
      prisma.category.findMany({
        where: { active: true },
        orderBy: [{ sortOrder: "asc" }, { nameAr: "asc" }],
        take: 200,
        select: { id: true, nameAr: true, nameEn: true },
      }),
    ]);
    return NextResponse.json({ success: true, data: { games, apps, mods, categories } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "FORBIDDEN";
    return NextResponse.json({ success: false, error: message }, { status: message === "UNAUTHORIZED" ? 401 : 403 });
  }
}

export async function POST(request: NextRequest) {
  const blocked = await guardMutation(request, "admin:content:create", 30);
  if (blocked) return blocked;

  let uploadedSource = "";
  const uploadedImages: string[] = [];

  try {
    const owner = await requireOwner();
    const body = await request.json();
    const type = parseType(body.type);
    if (!type) return NextResponse.json({ success: false, error: "CONTENT_TYPE_REQUIRED" }, { status: 400 });

    const titleAr = clean(body.titleAr, 180);
    const titleEn = clean(body.titleEn, 180);
    const slug = normalizeSlug(clean(body.slug, 120));
    if (!titleAr || !titleEn || !slug) return NextResponse.json({ success: false, error: "TITLE_AND_SLUG_REQUIRED" }, { status: 400 });
    if (!(await uniqueSlug(slug))) return NextResponse.json({ success: false, error: "SLUG_ALREADY_EXISTS" }, { status: 409 });

    const platformValues = platforms(body.platforms);
    if (!platformValues.length) return NextResponse.json({ success: false, error: "PLATFORM_REQUIRED" }, { status: 400 });

    const confirmRights = body.confirmRights === true;
    if (!confirmRights) return NextResponse.json({ success: false, error: "DISTRIBUTION_RIGHTS_CONFIRMATION_REQUIRED" }, { status: 400 });

    const sourceMode = body.source?.mode === "url" ? "url" : body.source?.mode === "upload" ? "upload" : null;
    if (!sourceMode) return NextResponse.json({ success: false, error: "SOURCE_REQUIRED" }, { status: 400 });

    let sourceUrl = "";
    let sourceProvider: string | null = null;

    if (sourceMode === "upload") {
      const kind = type === "APP" ? "app" : type === "MOD" ? "mod" : "game";
      sourceUrl = canonicalBlobUrl(body.source?.blobUrl, kind) || "";
      if (!sourceUrl) return NextResponse.json({ success: false, error: "INVALID_UPLOADED_SOURCE" }, { status: 400 });
      uploadedSource = sourceUrl;
      sourceProvider = "GameVortex Blob";
    } else {
      const remote = await importRemoteContentFile(clean(body.source?.url, 4000), type === "APP" ? "app" : "game");
      sourceUrl = remote.url;
      uploadedSource = remote.url;
      sourceProvider = new URL(remote.finalUrl).hostname.slice(0, 120);
    }

    const rawImages = Array.isArray(body.imageUrls) ? body.imageUrls.filter((value: unknown): value is string => typeof value === "string") : [];
    if (rawImages.length > 12) return NextResponse.json({ success: false, error: "TOO_MANY_IMAGES" }, { status: 400 });
    const imageUrls = rawImages.map((url) => canonicalBlobUrl(url, "image")).filter((url): url is string => Boolean(url));
    if (imageUrls.length !== rawImages.length) return NextResponse.json({ success: false, error: "INVALID_IMAGE" }, { status: 400 });
    uploadedImages.push(...imageUrls);

    const categoryIds = await ensureCategoryIds(prisma, Array.isArray(body.categoryIds) ? body.categoryIds : []);
    const sourceStatus = normalizeUploadSourceStatus(body.sourceStatus || DEFAULT_UPLOAD_SOURCE_STATUS);
    const description = clean(body.description, 4000) || null;
    const priceCents = Math.max(0, Math.round((Number(body.price) || 0) * 100));
    const discountPercent = Math.min(100, Math.max(0, Math.round(Number(body.discount) || 0)));
    const published = body.published === true;
    const featured = body.featured === true;

    const result = await prisma.$transaction(async (tx) => {
      if (type === "GAME") {
        const game = await tx.game.create({
          data: {
            titleAr, titleEn, slug, description,
            platform: platformValues.join(","),
            priceCents, discountPercent,
            coverUrl: imageUrls[0] || null,
            downloadSource: sourceUrl,
            sourceStatus, sourceProvider,
            published, featured,
            gamePlatforms: { create: platformValues.map((platform) => ({ platform })) },
            gameCategories: categoryIds.length ? { create: categoryIds.map((categoryId) => ({ categoryId })) } : undefined,
            images: imageUrls.length ? { create: imageUrls.map((url, index) => ({ url, sortOrder: index })) } : undefined,
          },
        });
        await tx.auditLog.create({
          data: { actorUserId: owner.id, action: "UNIFIED_CONTENT_CREATED", entityType: "Game", entityId: game.id, metadata: { slug, imageCount: imageUrls.length, sourceMode, sourceProvider } },
        });
        return { type, id: game.id, slug: game.slug };
      }

      if (type === "APP") {
        const app = await tx.app.create({
          data: {
            nameAr: titleAr, nameEn: titleEn, slug, descriptionAr: description,
            coverUrl: imageUrls[0] || null, iconUrl: imageUrls[0] || null,
            downloadSource: sourceUrl, sourceStatus, sourceProvider,
            priceCents, discountPercent, published, featured,
            appPlatforms: { create: platformValues.map((platform) => ({ platform })) },
            appCategories: { create: categoryIds.map((categoryId) => ({ categoryId })) },
            images: imageUrls.length ? { create: imageUrls.map((url, index) => ({ url, sortOrder: index })) } : undefined,
          },
        });
        await tx.auditLog.create({
          data: { actorUserId: owner.id, action: "UNIFIED_CONTENT_CREATED", entityType: "App", entityId: app.id, metadata: { slug, imageCount: imageUrls.length, sourceMode, sourceProvider } },
        });
        return { type, id: app.id, slug: app.slug };
      }

      const gameId = clean(body.gameId, 100) || null;
      if (gameId) {
        const game = await tx.game.findUnique({ where: { id: gameId }, select: { id: true } });
        if (!game) throw new Error("GAME_NOT_FOUND");
      }
      const mod = await tx.mod.create({
        data: {
          slug, titleAr, titleEn, descriptionAr: description,
          imageUrl: imageUrls[0] || null,
          downloadUrl: sourceUrl, sourceProvider, sourceStatus,
          platform: platformValues[0], gameId, published, featured,
        },
      });
      await tx.auditLog.create({
        data: { actorUserId: owner.id, action: "UNIFIED_CONTENT_CREATED", entityType: "Mod", entityId: mod.id, metadata: { slug, sourceMode, sourceProvider } },
      });
      return { type, id: mod.id, slug: mod.slug };
    });

    return NextResponse.json({ success: true, data: result }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      await safeCleanupBlobs([uploadedSource, ...uploadedImages].filter(Boolean));
      return NextResponse.json({ success: false, error: "SLUG_ALREADY_EXISTS" }, { status: 409 });
    }
    await safeCleanupBlobs([uploadedSource, ...uploadedImages].filter(Boolean));
    const message = error instanceof Error ? error.message : "CONTENT_CREATE_FAILED";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
