import { NextRequest, NextResponse } from "next/server";
import dns from "node:dns/promises";
import net from "node:net";
import { put } from "@vercel/blob";
import { db } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth";
import { guardMutation } from "@/lib/api";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_IMPORT_BYTES = 512 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const ALLOWED_SCHEMES = new Set(["http:", "https:"]);
const ALLOWED_STATUS = new Set([
  "OFFICIAL_SOURCE",
  "LICENSED_FOR_DISTRIBUTION",
  "OPEN_SOURCE",
  "FREEWARE_REDISTRIBUTABLE",
]);

function isPrivateIp(address: string) {
  const family = net.isIP(address);
  if (family === 4) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    return (
      normalized === "::1" ||
      normalized === "::" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:")
    );
  }
  return true;
}

async function assertSafeRemoteUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("INVALID_SOURCE_URL");
  }

  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    throw new Error("SOURCE_PROTOCOL_NOT_ALLOWED");
  }

  if (url.username || url.password) {
    throw new Error("SOURCE_CREDENTIALS_NOT_ALLOWED");
  }

  const addresses = await dns.lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error("SOURCE_HOST_NOT_ALLOWED");
  }

  return url;
}

async function fetchRemoteFile(initialUrl: string) {
  let current = await assertSafeRemoteUrl(initialUrl);

  for (let attempt = 0; attempt <= MAX_REDIRECTS; attempt += 1) {
    const response = await fetch(current, {
      redirect: "manual",
      headers: {
        "User-Agent": "GameVortex-Downloader/1.0",
        Accept: "*/*",
      },
      signal: AbortSignal.timeout(120_000),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || attempt === MAX_REDIRECTS) {
        throw new Error("TOO_MANY_REDIRECTS");
      }
      current = await assertSafeRemoteUrl(new URL(location, current).toString());
      continue;
    }

    if (!response.ok || !response.body) {
      throw new Error(`SOURCE_DOWNLOAD_FAILED_${response.status}`);
    }

    return { response, finalUrl: current.toString() };
  }

  throw new Error("SOURCE_DOWNLOAD_FAILED");
}

function filenameFromUrl(url: string) {
  try {
    const parsed = new URL(url);
    const raw = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || "gamevortex-download");
    const clean = raw.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 180);
    return clean || "gamevortex-download";
  } catch {
    return "gamevortex-download";
  }
}

function extensionOf(name: string) {
  const match = /\.([a-z0-9]{1,12})$/i.exec(name);
  return match?.[1]?.toLowerCase() || "";
}

function allowedFile(name: string, contentType: string) {
  const ext = extensionOf(name);
  const allowedExt = new Set([
    "apk","xapk","apks","aab","exe","msi","zip","7z","rar","dmg","pkg","deb","rpm","appimage","tar","gz","iso"
  ]);
  if (allowedExt.has(ext)) return true;
  return [
    "application/octet-stream",
    "application/zip",
    "application/x-7z-compressed",
    "application/vnd.android.package-archive",
  ].includes(contentType);
}

function contentDisposition(filename: string) {
  const safe = filename.replace(/["\\\r\n]/g, "_");
  return `attachment; filename="${safe}"`;
}

export async function POST(request: NextRequest) {
  const blocked = await guardMutation(request, "admin:downloader:import", 5);
  if (blocked) return blocked;

  try {
    const owner = await requireOwner();
    const body = await request.json();

    const entityType = body.entityType === "APP" ? "APP" : body.entityType === "GAME" ? "GAME" : null;
    const entityId = typeof body.entityId === "string" ? body.entityId.trim() : "";
    const sourceUrl = typeof body.sourceUrl === "string" ? body.sourceUrl.trim() : "";
    const requestedFilename = typeof body.filename === "string" ? body.filename.trim() : "";
    const confirmRights = body.confirmRights === true;

    if (!entityType || !entityId || !sourceUrl) {
      return NextResponse.json({ success: false, error: "ENTITY_AND_SOURCE_REQUIRED" }, { status: 400 });
    }
    if (!confirmRights) {
      return NextResponse.json({ success: false, error: "DISTRIBUTION_RIGHTS_CONFIRMATION_REQUIRED" }, { status: 400 });
    }

    const entity = entityType === "GAME"
      ? await db.game.findUnique({ where: { id: entityId }, select: { id: true, slug: true, titleEn: true, sourceStatus: true } })
      : await db.app.findUnique({ where: { id: entityId }, select: { id: true, slug: true, nameEn: true, sourceStatus: true } });

    if (!entity) {
      return NextResponse.json({ success: false, error: "ENTITY_NOT_FOUND" }, { status: 404 });
    }

    if (!ALLOWED_STATUS.has(entity.sourceStatus)) {
      return NextResponse.json({
        success: false,
        error: "SOURCE_STATUS_NOT_DISTRIBUTABLE",
        message: "Set the product source status to an official/licensed/open-source/redistributable status before importing the file.",
      }, { status: 409 });
    }

    const { response, finalUrl } = await fetchRemoteFile(sourceUrl);
    const declaredSize = Number(response.headers.get("content-length") || 0);

    if (declaredSize > MAX_IMPORT_BYTES) {
      return NextResponse.json({ success: false, error: "SOURCE_FILE_TOO_LARGE" }, { status: 413 });
    }

    const contentType = (response.headers.get("content-type") || "application/octet-stream")
      .split(";", 1)[0]
      .trim()
      .toLowerCase();

    const contentDispositionHeader = response.headers.get("content-disposition") || "";
    const dispositionMatch = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(contentDispositionHeader);
    const filename = (requestedFilename || (dispositionMatch?.[1] ? decodeURIComponent(dispositionMatch[1]) : "") || filenameFromUrl(finalUrl))
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .slice(0, 180) || "gamevortex-download";

    if (!allowedFile(filename, contentType)) {
      return NextResponse.json({ success: false, error: "FILE_TYPE_NOT_ALLOWED" }, { status: 415 });
    }

    let bytesSeen = 0;
    const limitedStream = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytesSeen += chunk.byteLength;
        if (bytesSeen > MAX_IMPORT_BYTES) {
          controller.error(new Error("SOURCE_FILE_TOO_LARGE"));
          return;
        }
        controller.enqueue(chunk);
      },
    }));

    const blob = await put(
      `downloads/${entityType.toLowerCase()}/${entity.id}/${filename}`,
      limitedStream,
      {
        access: "public",
        addRandomSuffix: true,
        contentType,
        cacheControlMaxAge: 2592000,
      },
    );

    if (entityType === "GAME") {
      await db.game.update({
        where: { id: entity.id },
        data: {
          downloadSource: blob.downloadUrl,
          sourceStatus: "LICENSED_FOR_DISTRIBUTION",
          sourceProvider: new URL(finalUrl).hostname.slice(0, 120),
        },
      });
    } else {
      await db.app.update({
        where: { id: entity.id },
        data: {
          downloadSource: blob.downloadUrl,
          sourceStatus: "LICENSED_FOR_DISTRIBUTION",
          sourceProvider: new URL(finalUrl).hostname.slice(0, 120),
        },
      });
    }

    await db.auditLog.create({
      data: {
        actorUserId: owner.id,
        action: "DOWNLOAD_ASSET_IMPORTED",
        entityType,
        entityId: entity.id,
        metadata: {
          sourceUrl,
          finalSourceUrl: finalUrl,
          blobUrl: blob.url,
          filename,
          contentType,
          sizeBytes: bytesSeen || declaredSize || null,
          distributionRightsConfirmed: true,
        },
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        entityType,
        entityId: entity.id,
        filename,
        contentType,
        sizeBytes: bytesSeen || declaredSize || 0,
        downloadUrl: blob.downloadUrl,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "DOWNLOAD_IMPORT_FAILED";
    console.error("POST /api/admin/downloader/import error:", message);
    return NextResponse.json({ success: false, error: "DOWNLOAD_IMPORT_FAILED", message }, { status: 500 });
  }
}
