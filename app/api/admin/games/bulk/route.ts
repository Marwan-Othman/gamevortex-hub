import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getOptionalUser } from "@/lib/auth";
import { guardMutation } from "@/lib/api";
import { getPlatformEnum, type GamePlatformEnum } from "@/lib/platforms";
import {
  MAX_GAMES_PER_BATCH,
  canonicalBlobUrl,
  normalizeUploadSourceStatus,
  slugify,
  type DistributableSourceStatus,
} from "@/lib/game-upload-shared";
import {
  findReferencedBlobUrls,
  resolveUploadCategoryIds,
  safeCleanupBlobs,
} from "@/lib/game-upload-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Receives metadata + Blob URLs only. Game files are uploaded browser -> Vercel Blob first,
 * so this endpoint never handles binary data.
 */

type PreparedGame = {
  titleAr: string;
  titleEn: string;
  slug: string;
  platformValues: GamePlatformEnum[];
  downloadSource: string;
  description: string | null;
  priceCents: number;
  discountPercent: number;
  categoryValues: string[];
  sourceStatus: DistributableSourceStatus;
  published: boolean;
  featured: boolean;
};

class BulkValidationError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly detail?: Record<string, unknown>,
  ) {
    super(code);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parsePlatforms(value: unknown): GamePlatformEnum[] {
  if (!Array.isArray(value)) return [];
  const out = new Set<GamePlatformEnum>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const platform = getPlatformEnum(entry);
    if (platform) out.add(platform);
  }
  return Array.from(out);
}

function parsePriceCents(item: Record<string, unknown>): number {
  const cents = finiteNumber(item.priceCents);
  if (cents !== null) return Math.max(0, Math.round(cents));
  const dollars = finiteNumber(item.price);
  return dollars !== null ? Math.max(0, Math.round(dollars * 100)) : 0;
}

function parseDiscount(item: Record<string, unknown>): number {
  const value = finiteNumber(item.discountPercent) ?? finiteNumber(item.discount);
  return value === null ? 0 : Math.min(100, Math.max(0, Math.round(value)));
}

function prepareGame(raw: unknown, index: number): PreparedGame {
  const position = index + 1;
  if (!isRecord(raw)) throw new BulkValidationError("INVALID_GAME", 400, { index: position });

  const titleAr = text(raw.titleAr, 160);
  const titleEn = text(raw.titleEn, 160);
  const slug = slugify(text(raw.slug, 160), 100);
  if (!titleAr || !titleEn || !slug) throw new BulkValidationError("INVALID_GAME", 400, { index: position });

  const platformValues = parsePlatforms(raw.platforms);
  if (!platformValues.length) throw new BulkValidationError("INVALID_PLATFORM", 400, { index: position, slug });

  const downloadSource = canonicalBlobUrl(raw.downloadSource, "game");
  if (!downloadSource) throw new BulkValidationError("INVALID_DOWNLOAD_SOURCE", 400, { index: position, slug });

  const categoryValues = Array.isArray(raw.categoryIds)
    ? raw.categoryIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];

  const description = text(raw.descriptionAr, 4000) || text(raw.descriptionEn, 4000) || null;

  return {
    titleAr,
    titleEn,
    slug,
    platformValues,
    downloadSource,
    description,
    priceCents: parsePriceCents(raw),
    discountPercent: parseDiscount(raw),
    categoryValues,
    sourceStatus: normalizeUploadSourceStatus(raw.sourceStatus),
    published: typeof raw.published === "boolean" ? raw.published : false,
    featured: typeof raw.featured === "boolean" ? raw.featured : false,
  };
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) dupes.add(value);
    seen.add(value);
  }
  return Array.from(dupes);
}

function errorResponse(error: BulkValidationError) {
  return NextResponse.json(
    { success: false, error: error.code, ...(error.detail ? { detail: error.detail } : {}) },
    { status: error.status },
  );
}

export async function POST(request: NextRequest) {
  const guard = await guardMutation(request, "admin-game-bulk", 60);
  if (guard) return guard;

  // Server-side authorization: never rely on the UI. Role only, no email/username checks.
  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (user.role !== "SUPER_ADMIN") return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "INVALID_JSON" }, { status: 400 });
  }

  const rawGames = isRecord(body) ? body.games : undefined;
  if (!Array.isArray(rawGames) || rawGames.length < 1 || rawGames.length > MAX_GAMES_PER_BATCH) {
    return NextResponse.json(
      { success: false, error: "INVALID_BATCH_SIZE", detail: { min: 1, max: MAX_GAMES_PER_BATCH } },
      { status: 400 },
    );
  }

  // Blob URLs that belong to this request; only deleted when the database write itself fails.
  let requestUrls: string[] = [];

  try {
    const prepared: PreparedGame[] = rawGames.map((item: unknown, index: number) => prepareGame(item, index));
    requestUrls = prepared.map((game) => game.downloadSource);

    const slugDupes = duplicates(prepared.map((game) => game.slug));
    if (slugDupes.length) throw new BulkValidationError("SLUG_DUPLICATE_IN_BATCH", 409, { slugs: slugDupes });

    const urlDupes = duplicates(prepared.map((game) => game.downloadSource));
    if (urlDupes.length) throw new BulkValidationError("DUPLICATE_DOWNLOAD_SOURCE_IN_BATCH", 400);

    const existing = await prisma.game.findMany({
      where: { slug: { in: prepared.map((game) => game.slug) } },
      select: { slug: true },
    });
    if (existing.length) {
      throw new BulkValidationError("SLUG_ALREADY_EXISTS", 409, { slugs: existing.map((row) => row.slug) });
    }

    // A file already attached to another Game/Mod must never be re-used (or cleaned up) here.
    const referenced = await findReferencedBlobUrls(requestUrls);
    if (referenced.size) {
      requestUrls = requestUrls.filter((url) => !referenced.has(url));
      throw new BulkValidationError("DOWNLOAD_SOURCE_ALREADY_USED", 409);
    }

    // Categories are resolved per distinct selection, then applied only to the games that chose them.
    const categoryCache = new Map<string, string[]>();
    const categoryIdsByGame: string[][] = [];
    for (const game of prepared) {
      const key = Array.from(new Set(game.categoryValues)).sort().join("|");
      let ids = categoryCache.get(key);
      if (!ids) {
        ids = await resolveUploadCategoryIds(game.categoryValues);
        categoryCache.set(key, ids);
      }
      categoryIdsByGame.push(ids);
    }

    const created = await prisma.$transaction(
      async (tx) => {
        const rows: { id: string; slug: string; titleAr: string; titleEn: string; published: boolean }[] = [];
        for (const [index, item] of prepared.entries()) {
          const categoryIds = categoryIdsByGame[index] ?? [];
          const game = await tx.game.create({
            data: {
              titleAr: item.titleAr,
              titleEn: item.titleEn,
              slug: item.slug,
              description: item.description,
              genre: null,
              platform: item.platformValues.join(","),
              priceCents: item.priceCents,
              discountPercent: item.discountPercent,
              coverUrl: null,
              officialUrl: null,
              downloadSource: item.downloadSource,
              sourceStatus: item.sourceStatus,
              published: item.published,
              featured: item.featured,
              gamePlatforms: { create: item.platformValues.map((platform) => ({ platform })) },
              ...(categoryIds.length
                ? { gameCategories: { create: categoryIds.map((categoryId) => ({ categoryId })) } }
                : {}),
            },
            select: { id: true, slug: true, titleAr: true, titleEn: true, published: true, sourceStatus: true },
          });

          await tx.auditLog.create({
            data: {
              actorUserId: user.id,
              action: "GAME_CREATED_WITH_FILE_UPLOAD",
              entityType: "Game",
              entityId: game.id,
              metadata: {
                actorUserId: user.id,
                gameId: game.id,
                slug: game.slug,
                published: game.published,
                sourceStatus: game.sourceStatus,
                bulkUpload: true,
                batchSize: prepared.length,
              },
            },
          });

          rows.push({
            id: game.id,
            slug: game.slug,
            titleAr: game.titleAr,
            titleEn: game.titleEn,
            published: game.published,
          });
        }
        return rows;
      },
      { maxWait: 10_000, timeout: 55_000 },
    );

    return NextResponse.json({ success: true, count: created.length, data: created }, { status: 201 });
  } catch (error) {
    if (error instanceof BulkValidationError) {
      // Validation/conflict: nothing was written. Uploaded files are kept so the owner can fix
      // the data and retry without re-uploading; the client offers an explicit "discard" action.
      return errorResponse(error);
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ success: false, error: "SLUG_ALREADY_EXISTS" }, { status: 409 });
    }

    console.error("POST /api/admin/games/bulk error:", error instanceof Error ? error.message : "UNKNOWN");
    // The transaction rolled back: remove the files that were uploaded for this batch.
    await safeCleanupBlobs(requestUrls);
    return NextResponse.json({ success: false, error: "BULK_CREATE_FAILED" }, { status: 500 });
  }
}
