
import { NextRequest, NextResponse } from "next/server";
import dns from "node:dns/promises";
import net from "node:net";
import { put } from "@vercel/blob";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/prisma";
import { guardMutation } from "@/lib/api";
import { requireOwner } from "@/lib/auth";
import { getPlatformEnum } from "@/lib/platforms";
import { resolveUploadCategoryIds } from "@/lib/game-upload-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_IMPORT_BYTES = 512 * 1024 * 1024;
const MAX_IMAGES = 12;
const MAX_IMAGE_URL_LENGTH = 1200;
const ALLOWED_MIME = "application/vnd.android.package-archive";

function privateIp(address: string) {
  const family = net.isIP(address);
  if (family === 4) {
    const [a,b] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (family === 6) {
    const v = address.toLowerCase();
    return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80:");
  }
  return true;
}

async function safeRemoteUrl(raw: string) {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("INVALID_SOURCE_URL"); }
  if (!["http:","https:"].includes(url.protocol)) throw new Error("SOURCE_PROTOCOL_NOT_ALLOWED");
  if (url.username || url.password) throw new Error("SOURCE_CREDENTIALS_NOT_ALLOWED");
  const addresses = await dns.lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((x) => privateIp(x.address))) throw new Error("SOURCE_HOST_NOT_ALLOWED");
  return url;
}

function ownedBlobUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || !url.hostname.endsWith(".blob.vercel-storage.com") || url.username || url.password) return null;
    return url.toString().split("#")[0];
  } catch { return null; }
}

function cleanText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeSlug(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 100);
}

async function importApk(sourceUrl: string, entityKey: string) {
  let current = await safeRemoteUrl(sourceUrl);
  for (let attempt = 0; attempt <= 5; attempt += 1) {
    const response = await fetch(current, {
      redirect: "manual",
      headers: { "User-Agent": "GameVortex-Content-Importer/1.0", Accept: "*/*" },
      signal: AbortSignal.timeout(120000),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || attempt === 5) throw new Error("TOO_MANY_REDIRECTS");
      current = await safeRemoteUrl(new URL(location, current).toString());
      continue;
    }
    if (!response.ok || !response.body) throw new Error(`SOURCE_DOWNLOAD_FAILED_${response.status}`);

    const contentType = (response.headers.get("content-type") || "application/octet-stream").split(";")[0].trim().toLowerCase();
    const pathName = decodeURIComponent(current.pathname.split("/").filter(Boolean).pop() || "");
    if (contentType !== ALLOWED_MIME && !/\.apk$/i.test(pathName)) throw new Error("FILE_TYPE_NOT_ALLOWED");

    const declaredSize = Number(response.headers.get("content-length") || 0);
    if (declaredSize > MAX_IMPORT_BYTES) throw new Error("SOURCE_FILE_TOO_LARGE");

    let bytesSeen = 0;
    const stream = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytesSeen += chunk.byteLength;
        if (bytesSeen > MAX_IMPORT_BYTES) { controller.error(new Error("SOURCE_FILE_TOO_LARGE")); return; }
        controller.enqueue(chunk);
      },
    }));

    const filename = (pathName || `${entityKey}.apk`).replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-180) || `${entityKey}.apk`;
    const blob = await put(`content/apk/${entityKey}/${filename}`, stream, {
      access: "public",
      addRandomSuffix: true,
      contentType: ALLOWED_MIME,
      cacheControlMaxAge: 2592000,
    });
    return blob.url;
  }
  throw new Error("SOURCE_DOWNLOAD_FAILED");
}

function imageUrls(value: unknown) {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const item of value.slice(0, MAX_IMAGES)) {
    const url = ownedBlobUrl(item);
    if (!url || url.length > MAX_IMAGE_URL_LENGTH) continue;
    result.push(url);
  }
  return [...new Set(result)];
}

export async function GET(request: NextRequest) {
  try {
    await requireOwner();
    const search = request.nextUrl.searchParams.get("search")?.trim() || "";
    const [games, apps] = await Promise.all([
      db.game.findMany({ where: search ? { OR: [{ titleAr: { contains: search, mode: "insensitive" } }, { titleEn: { contains: search, mode: "insensitive" } }] } : undefined, orderBy: { updatedAt: "desc" }, take: 100 }),
      db.app.findMany({ where: search ? { OR: [{ nameAr: { contains: search, mode: "insensitive" } }, { nameEn: { contains: search, mode: "insensitive" } }] } : undefined, orderBy: { updatedAt: "desc" }, take: 100 }),
    ]);
    return NextResponse.json({ success: true, data: { games, apps } });
  } catch {
    return NextResponse.json({ success: false, error: "UNAUTHORIZED" }, { status: 401 });
  }
}

export async function POST(request: NextRequest) {
  const blocked = await guardMutation(request, "admin:content:create", 10);
  if (blocked) return blocked;

  try {
    const owner = await requireOwner();
    const body = await request.json();
    const contentType = body.contentType === "APP" ? "APP" : body.contentType === "GAME" ? "GAME" : null;
    const sourceMode = body.sourceMode === "URL" ? "URL" : body.sourceMode === "UPLOAD" ? "UPLOAD" : null;
    if (!contentType || !sourceMode) return NextResponse.json({ success: false, error: "INVALID_CONTENT_TYPE_OR_SOURCE" }, { status: 400 });
    if (body.rightsConfirmed !== true) return NextResponse.json({ success: false, error: "DISTRIBUTION_RIGHTS_CONFIRMATION_REQUIRED" }, { status: 400 });

    const titleAr = cleanText(body.titleAr ?? body.nameAr, 180);
    const titleEn = cleanText(body.titleEn ?? body.nameEn, 180);
    const slug = normalizeSlug(cleanText(body.slug, 100));
    const description = cleanText(body.description, 4000) || null;
    const platform = getPlatformEnum(cleanText(body.platform, 40));
    if (!titleAr || !titleEn || !slug || !platform) return NextResponse.json({ success: false, error: "NAME_SLUG_AND_PLATFORM_REQUIRED" }, { status: 400 });

    const existingGame = await db.game.findUnique({ where: { slug }, select: { id: true } });
    const existingApp = await db.app.findUnique({ where: { slug }, select: { id: true } });
    if (existingGame || existingApp) return NextResponse.json({ success: false, error: "SLUG_ALREADY_EXISTS" }, { status: 409 });

    const gallery = imageUrls(body.galleryUrls);
    let downloadSource = ownedBlobUrl(body.downloadSource);
    if (sourceMode === "UPLOAD" && !downloadSource) return NextResponse.json({ success: false, error: "INVALID_UPLOADED_APK" }, { status: 400 });

    if (sourceMode === "URL") {
      const sourceUrl = cleanText(body.sourceUrl, 2000);
      if (!sourceUrl) return NextResponse.json({ success: false, error: "SOURCE_URL_REQUIRED" }, { status: 400 });
      downloadSource = await importApk(sourceUrl, slug);
    }

    if (!downloadSource) throw new Error("DOWNLOAD_SOURCE_REQUIRED");

    const categoryIds = body.categoryId ? await resolveUploadCategoryIds([cleanText(body.categoryId, 100)]) : [];
    const priceCents = Math.max(0, Number(body.priceCents) || 0);
    const discountPercent = Math.min(100, Math.max(0, Number(body.discountPercent) || 0));
    const published = body.published === true;
    const isMod = contentType === "GAME" && body.isMod === true;

    const result = await db.$transaction(async (tx) => {
      if (contentType === "GAME") {
        const game = await tx.game.create({
          data: {
            titleAr, titleEn, slug, description,
            platform: platform,
            genre: null,
            priceCents, discountPercent,
            coverUrl: gallery[0] || null,
            galleryUrls: gallery,
            downloadSource,
            sourceStatus: "LICENSED_FOR_DISTRIBUTION",
            sourceProvider: sourceMode === "URL" ? "Remote APK import" : "GameVortex Blob",
            published,
            featured: false,
            gamePlatforms: { create: [{ platform }] },
            gameCategories: categoryIds.length ? { create: categoryIds.map((categoryId) => ({ categoryId })) } : undefined,
          },
        });

        let mod = null;
        if (isMod) {
          mod = await tx.mod.create({
            data: {
              slug: `${slug}-mod-${game.id}`,
              titleAr: `${titleAr} Mod`,
              titleEn: `${titleEn} Mod`,
              descriptionAr: description,
              imageUrl: gallery[0] || null,
              downloadUrl: downloadSource,
              sourceProvider: sourceMode === "URL" ? "Remote APK import" : "GameVortex Blob",
              sourceStatus: "LICENSED_FOR_DISTRIBUTION",
              platform,
              gameId: game.id,
              published,
              featured: false,
              sortOrder: 0,
            },
          });
        }

        await tx.auditLog.create({
          data: {
            actorUserId: owner.id,
            action: isMod ? "GAME_CREATED_WITH_MOD_UNIFIED_CONTENT" : "GAME_CREATED_UNIFIED_CONTENT",
            entityType: "Game",
            entityId: game.id,
            metadata: { slug, sourceMode, platform, galleryCount: gallery.length, published, modId: mod?.id ?? null },
          },
        });
        return { type: "GAME", gameId: game.id, modId: mod?.id ?? null };
      }

      const app = await tx.app.create({
        data: {
          nameAr: titleAr,
          nameEn: titleEn,
          slug,
          descriptionAr: description,
          descriptionEn: null,
          developer: cleanText(body.developer, 180) || null,
          publisher: cleanText(body.publisher, 180) || null,
          iconUrl: gallery[0] || null,
          coverUrl: gallery[0] || null,
          galleryUrls: gallery,
          officialUrl: null,
          downloadSource,
          sourceStatus: "LICENSED_FOR_DISTRIBUTION",
          sourceProvider: sourceMode === "URL" ? "Remote APK import" : "GameVortex Blob",
          priceCents,
          discountPercent,
          published,
          featured: false,
          appPlatforms: { create: [{ platform }] },
          appCategories: categoryIds.length ? { create: categoryIds.map((categoryId) => ({ categoryId })) } : undefined,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: owner.id,
          action: "APP_CREATED_UNIFIED_CONTENT",
          entityType: "App",
          entityId: app.id,
          metadata: { slug, sourceMode, platform, galleryCount: gallery.length, published },
        },
      });
      return { type: "APP", appId: app.id };
    });

    return NextResponse.json({ success: true, data: result }, { status: 201 });
  } catch (error) {
    console.error("POST /api/admin/content error:", error instanceof Error ? error.message : "UNKNOWN");
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ success: false, error: "SLUG_ALREADY_EXISTS" }, { status: 409 });
    }
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "CONTENT_CREATE_FAILED" }, { status: 500 });
  }
}
