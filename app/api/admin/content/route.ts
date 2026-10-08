import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth";
import { guardMutation, guardRead } from "@/lib/api";
import { canonicalContentBlobUrl } from "@/lib/content-upload-shared";
import { importRemoteApk } from "@/lib/admin-content-import";
import { safeCleanupBlobs } from "@/lib/game-upload-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLATFORMS = ["PC","PLAYSTATION","XBOX","NINTENDO","ANDROID","IOS","MAC","LINUX","STEAM_DECK","WEB"] as const;
const VERSION_TYPES = ["STANDARD","MOD"] as const;

function cleanString(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeName(value: unknown) {
  return cleanString(value, 180);
}

function slugify(value: string) {
  return value.trim().toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 100);
}

function normalizeScreenshots(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((item): item is string => typeof item === "string")
    .map((item) => canonicalContentBlobUrl(item, "image")).filter((item): item is string => Boolean(item)))).slice(0, 30);
}

function validatePlatform(value: unknown) {
  return typeof value === "string" && (PLATFORMS as readonly string[]).includes(value) ? value : null;
}

function validateVersionType(value: unknown) {
  return typeof value === "string" && (VERSION_TYPES as readonly string[]).includes(value) ? value : null;
}

function parseCommon(body: Record<string, unknown>) {
  const contentType = body.contentType === "APP" ? "APP" : body.contentType === "GAME" ? "GAME" : null;
  const name = normalizeName(body.name);
  const description = cleanString(body.description, 10000) || null;
  const platform = validatePlatform(body.platform);
  const versionType = validateVersionType(body.versionType) ?? "STANDARD";
  const sourceMode = body.sourceMode === "URL" ? "URL" : body.sourceMode === "UPLOAD" ? "UPLOAD" : null;
  const mainImageUrl = body.mainImageUrl === null ? null : canonicalContentBlobUrl(body.mainImageUrl, "image");
  const screenshots = normalizeScreenshots(body.screenshotUrls);
  if (!contentType || !name || !platform || !sourceMode) throw new Error("INVALID_CONTENT_DATA");
  if (platform !== "ANDROID") throw new Error("APK_CONTENT_REQUIRES_ANDROID");
  if (!versionType) throw new Error("INVALID_VERSION_TYPE");
  if (body.mainImageUrl && !mainImageUrl) throw new Error("INVALID_MAIN_IMAGE");
  return { contentType, name, description, platform, versionType, sourceMode, mainImageUrl, screenshots };
}

async function uniqueSlug(contentType: "GAME" | "APP", base: string, currentId?: string) {
  const source = slugify(base) || "content";
  let candidate = source;
  for (let n = 2; n < 1000; n += 1) {
    const exists = contentType === "GAME"
      ? await db.game.findFirst({ where: { slug: candidate, ...(currentId ? { id: { not: currentId } } : {}) }, select: { id: true } })
      : await db.app.findFirst({ where: { slug: candidate, ...(currentId ? { id: { not: currentId } } : {}) }, select: { id: true } });
    if (!exists) return candidate;
    candidate = `${source}-${n}`;
  }
  throw new Error("SLUG_GENERATION_FAILED");
}

async function getRecord(id: string) {
  const [game, app] = await Promise.all([
    db.game.findUnique({ where: { id }, include: { gamePlatforms: true } }),
    db.app.findUnique({ where: { id }, include: { appPlatforms: true } }),
  ]);
  if (game) return {
    id: game.id, contentType: "GAME" as const, name: game.titleAr, description: game.description,
    platform: game.gamePlatforms[0]?.platform ?? "ANDROID", versionType: game.versionType,
    mainImageUrl: game.coverUrl, screenshotUrls: Array.isArray(game.screenshots) ? game.screenshots.filter((x): x is string => typeof x === "string") : [],
    downloadSource: game.downloadSource, slug: game.slug, published: game.published,
  };
  if (app) return {
    id: app.id, contentType: "APP" as const, name: app.nameAr, description: app.descriptionAr,
    platform: app.appPlatforms[0]?.platform ?? "ANDROID", versionType: app.versionType,
    mainImageUrl: app.coverUrl, screenshotUrls: Array.isArray(app.screenshots) ? app.screenshots.filter((x): x is string => typeof x === "string") : [],
    downloadSource: app.downloadSource, slug: app.slug, published: app.published,
  };
  return null;
}

export async function GET(request: NextRequest) {
  const blocked = await guardRead(request, "admin-content", 60);
  if (blocked) return blocked;
  try {
    await requireOwner();
    const id = request.nextUrl.searchParams.get("id")?.trim();
    if (id) {
      const item = await getRecord(id);
      return item ? NextResponse.json({ success: true, data: item }) : NextResponse.json({ success: false, error: "NOT_FOUND" }, { status: 404 });
    }

    const [games, apps] = await Promise.all([
      db.game.findMany({ orderBy: { updatedAt: "desc" }, take: 100, select: { id: true, titleAr: true, titleEn: true, slug: true, versionType: true, published: true, coverUrl: true, updatedAt: true } }),
      db.app.findMany({ orderBy: { updatedAt: "desc" }, take: 100, select: { id: true, nameAr: true, nameEn: true, slug: true, versionType: true, published: true, coverUrl: true, updatedAt: true } }),
    ]);
    return NextResponse.json({
      success: true,
      data: [
        ...games.map((x) => ({ id:x.id, contentType:"GAME" as const, name:x.titleAr, secondaryName:x.titleEn, slug:x.slug, versionType:x.versionType, published:x.published, imageUrl:x.coverUrl, updatedAt:x.updatedAt })),
        ...apps.map((x) => ({ id:x.id, contentType:"APP" as const, name:x.nameAr, secondaryName:x.nameEn, slug:x.slug, versionType:x.versionType, published:x.published, imageUrl:x.coverUrl, updatedAt:x.updatedAt })),
      ].sort((a,b)=>b.updatedAt.getTime()-a.updatedAt.getTime()),
    });
  } catch (error) {
    return NextResponse.json({ success:false, error:error instanceof Error ? error.message : "UNAUTHORIZED" }, { status:401 });
  }
}

export async function POST(request: NextRequest) {
  const blocked = await guardMutation(request, "admin-content-create", 20);
  if (blocked) return blocked;
  let createdDownloadBlobUrl: string | null = null;
  try {
    const owner = await requireOwner();
    const body = await request.json() as Record<string, unknown>;
    const parsed = parseCommon(body);
    const apkBlob = parsed.sourceMode === "UPLOAD" ? canonicalContentBlobUrl(body.apkUrl, "apk") : null;
    const remoteUrl = cleanString(body.apkUrl, 2000);

    if (parsed.sourceMode === "UPLOAD" && !apkBlob) throw new Error("INVALID_APK_UPLOAD");
    if (parsed.sourceMode === "URL" && !remoteUrl) throw new Error("APK_URL_REQUIRED");

    let downloadSource = apkBlob;
    let imported: { finalUrl: string; filename: string; sizeBytes: number } | null = null;

    if (parsed.sourceMode === "URL") {
      const result = await importRemoteApk(remoteUrl);
      downloadSource = result.url;
      createdDownloadBlobUrl = result.url;
      imported = { finalUrl: result.finalUrl, filename: result.filename, sizeBytes: result.sizeBytes };
    }

    if (!downloadSource) throw new Error("APK_SOURCE_REQUIRED");

    const slug = await uniqueSlug(parsed.contentType, body.slug ? cleanString(body.slug, 100) : parsed.name);
    const platform = "ANDROID";

    const result = await db.$transaction(async (tx) => {
      if (parsed.contentType === "GAME") {
        const game = await tx.game.create({
          data: {
            titleAr: parsed.name, titleEn: parsed.name, slug, description: parsed.description,
            platform, coverUrl: parsed.mainImageUrl, downloadSource, sourceStatus: "LICENSED_FOR_DISTRIBUTION",
            published: true, versionType: parsed.versionType as Prisma.GameCreateInput["versionType"],
            screenshots: parsed.screenshots,
            gamePlatforms: { create: [{ platform: "ANDROID" }] },
          },
        });
        await tx.auditLog.create({ data: { actorUserId: owner.id, action: "CONTENT_CREATED", entityType: "Game", entityId: game.id, metadata: { sourceMode: parsed.sourceMode, versionType: parsed.versionType, imported } } });
        return { id: game.id, contentType: "GAME" as const };
      }

      const app = await tx.app.create({
        data: {
          nameAr: parsed.name, nameEn: parsed.name, slug, descriptionAr: parsed.description,
          coverUrl: parsed.mainImageUrl, iconUrl: parsed.mainImageUrl, downloadSource,
          sourceStatus: "LICENSED_FOR_DISTRIBUTION", published: true,
          versionType: parsed.versionType as Prisma.AppCreateInput["versionType"],
          screenshots: parsed.screenshots,
          appPlatforms: { create: [{ platform: "ANDROID" }] },
        },
      });
      await tx.auditLog.create({ data: { actorUserId: owner.id, action: "CONTENT_CREATED", entityType: "App", entityId: app.id, metadata: { sourceMode: parsed.sourceMode, versionType: parsed.versionType, imported } } });
      return { id: app.id, contentType: "APP" as const };
    });

    return NextResponse.json({ success:true, data:result }, { status:201 });
  } catch (error) {
    if (createdDownloadBlobUrl) await safeCleanupBlobs([createdDownloadBlobUrl]);
    const message = error instanceof Error ? error.message : "CONTENT_CREATE_FAILED";
    const status = ["INVALID_CONTENT_DATA","APK_CONTENT_REQUIRES_ANDROID","INVALID_VERSION_TYPE","INVALID_MAIN_IMAGE","INVALID_APK_UPLOAD","APK_URL_REQUIRED","APK_SOURCE_REQUIRED","SOURCE_IS_NOT_APK","SOURCE_FILE_TOO_LARGE"].includes(message) ? 400 : message === "FORBIDDEN" || message === "UNAUTHORIZED" ? 403 : 500;
    return NextResponse.json({ success:false, error:message }, { status });
  }
}

export async function PATCH(request: NextRequest) {
  const blocked = await guardMutation(request, "admin-content-update", 20);
  if (blocked) return blocked;
  let createdDownloadBlobUrl: string | null = null;
  try {
    const owner = await requireOwner();
    const body = await request.json() as Record<string, unknown>;
    const id = cleanString(body.id, 100);
    if (!id) return NextResponse.json({ success:false, error:"CONTENT_ID_REQUIRED" }, { status:400 });
    const parsed = parseCommon(body);

    const existing = await getRecord(id);
    if (!existing) return NextResponse.json({ success:false, error:"NOT_FOUND" }, { status:404 });
    if (existing.contentType !== parsed.contentType) return NextResponse.json({ success:false, error:"CONTENT_TYPE_CANNOT_CHANGE" }, { status:400 });

    let downloadSource = existing.downloadSource;
    let imported: { finalUrl: string; filename: string; sizeBytes: number } | null = null;
    if (parsed.sourceMode === "UPLOAD" && body.apkUrl) {
      downloadSource = canonicalContentBlobUrl(body.apkUrl, "apk");
      if (!downloadSource) throw new Error("INVALID_APK_UPLOAD");
    } else if (parsed.sourceMode === "URL" && body.apkUrl) {
      const result = await importRemoteApk(cleanString(body.apkUrl, 2000));
      downloadSource = result.url;
      createdDownloadBlobUrl = result.url;
      imported = { finalUrl: result.finalUrl, filename: result.filename, sizeBytes: result.sizeBytes };
    }
    if (!downloadSource) throw new Error("APK_SOURCE_REQUIRED");

    const slug = await uniqueSlug(parsed.contentType, body.slug ? cleanString(body.slug,100) : parsed.name, id);
    const result = await db.$transaction(async (tx) => {
      if (parsed.contentType === "GAME") {
        const game = await tx.game.update({
          where: { id },
          data: {
            titleAr: parsed.name, titleEn: parsed.name, slug, description: parsed.description,
            platform: "ANDROID", coverUrl: parsed.mainImageUrl, downloadSource,
            sourceStatus: "LICENSED_FOR_DISTRIBUTION", published: true,
            versionType: parsed.versionType as Prisma.GameUpdateInput["versionType"],
            screenshots: parsed.screenshots,
          },
        });
        await tx.gamePlatform.deleteMany({ where: { gameId:id } });
        await tx.gamePlatform.create({ data:{ gameId:id, platform:"ANDROID" } });
        await tx.auditLog.create({ data:{ actorUserId:owner.id, action:"CONTENT_UPDATED", entityType:"Game", entityId:id, metadata:{ versionType:parsed.versionType, imported } } });
        return { id:game.id, contentType:"GAME" as const };
      }

      const app = await tx.app.update({
        where:{id},
        data:{
          nameAr:parsed.name, nameEn:parsed.name, slug, descriptionAr:parsed.description,
          coverUrl:parsed.mainImageUrl, iconUrl:parsed.mainImageUrl, downloadSource,
          sourceStatus:"LICENSED_FOR_DISTRIBUTION", published:true,
          versionType:parsed.versionType as Prisma.AppUpdateInput["versionType"],
          screenshots:parsed.screenshots,
        },
      });
      await tx.appPlatform.deleteMany({ where:{appId:id} });
      await tx.appPlatform.create({ data:{ appId:id, platform:"ANDROID" } });
      await tx.auditLog.create({ data:{ actorUserId:owner.id, action:"CONTENT_UPDATED", entityType:"App", entityId:id, metadata:{ versionType:parsed.versionType, imported } } });
      return { id:app.id, contentType:"APP" as const };
    });
    return NextResponse.json({success:true,data:result});
  } catch(error) {
    if (createdDownloadBlobUrl) await safeCleanupBlobs([createdDownloadBlobUrl]);
    const message=error instanceof Error?error.message:"CONTENT_UPDATE_FAILED";
    const status=["INVALID_CONTENT_DATA","APK_CONTENT_REQUIRES_ANDROID","INVALID_VERSION_TYPE","INVALID_MAIN_IMAGE","INVALID_APK_UPLOAD","APK_SOURCE_REQUIRED","SOURCE_IS_NOT_APK","SOURCE_FILE_TOO_LARGE"].includes(message)?400:message==="NOT_FOUND"?404:message==="FORBIDDEN"||message==="UNAUTHORIZED"?403:500;
    return NextResponse.json({success:false,error:message},{status});
  }
}
