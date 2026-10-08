import { NextResponse } from "next/server";
import type { PlatformType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth";
import {
  DEFAULT_UPLOAD_SOURCE_STATUS,
  UPLOAD_PLATFORM_OPTIONS,
  canonicalBlobUrl,
  slugify,
} from "@/lib/game-upload-shared";
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_NAME_LENGTH,
  MAX_SCREENSHOTS,
  isContentType,
  isHttpsUrl,
  normalizeExternalSourceUrl,
  type ContentFormData,
  type ContentType,
  type SourceMode,
} from "@/lib/content-admin";

const PLATFORM_VALUES = new Set<string>(UPLOAD_PLATFORM_OPTIONS.map(([value]) => value));

export type SourceInput =
  | { kind: "none" }
  | { kind: "upload"; url: string }
  | { kind: "link"; url: string };

export type ContentInput = {
  type: ContentType;
  name: string;
  description: string;
  platform: PlatformType;
  isMod: boolean;
  published: boolean;
  mainImage: string | null;
  screenshots: string[];
  source: SourceInput;
};

export type ContentInputResult = { ok: true; value: ContentInput } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Owner gate used by every content API. Server-side role check, never trusts the UI. */
export async function requireContentOwner() {
  try {
    const owner = await requireOwner();
    return { owner } as const;
  } catch (error) {
    const message = error instanceof Error ? error.message : "FORBIDDEN";
    if (message === "UNAUTHORIZED") {
      return { error: NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }) } as const;
    }
    return { error: NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 }) } as const;
  }
}

/**
 * Validates the whole body received from the browser. Nothing from the client is trusted:
 * every URL is re-validated, unknown fields are ignored, lengths are bounded.
 */
export function parseContentInput(
  body: unknown,
  options: { unchangedSourceUrl?: string | null; existingImageUrls?: readonly string[] } = {},
): ContentInputResult {
  if (!isRecord(body)) return { ok: false, error: "INVALID_BODY" };

  if (!isContentType(body.type)) return { ok: false, error: "INVALID_TYPE" };

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return { ok: false, error: "NAME_REQUIRED" };
  if (name.length > MAX_NAME_LENGTH) return { ok: false, error: "NAME_TOO_LONG" };

  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (description.length > MAX_DESCRIPTION_LENGTH) return { ok: false, error: "DESCRIPTION_TOO_LONG" };

  if (typeof body.platform !== "string" || !PLATFORM_VALUES.has(body.platform)) {
    return { ok: false, error: "INVALID_PLATFORM" };
  }
  const platform = body.platform as PlatformType;

  if (body.isMod !== undefined && typeof body.isMod !== "boolean") return { ok: false, error: "INVALID_VERSION_TYPE" };
  if (body.published !== undefined && typeof body.published !== "boolean") return { ok: false, error: "INVALID_PUBLISHED" };

  // Images already stored on this item (for example imported covers) stay valid when saved unchanged.
  const keptImages = new Set(options.existingImageUrls ?? []);
  const imageUrl = (value: unknown) =>
    canonicalBlobUrl(value, "cover") ?? (typeof value === "string" && keptImages.has(value) && isHttpsUrl(value) ? value : null);

  let mainImage: string | null = null;
  if (body.mainImage !== undefined && body.mainImage !== null && body.mainImage !== "") {
    mainImage = imageUrl(body.mainImage);
    if (!mainImage) return { ok: false, error: "INVALID_MAIN_IMAGE" };
  }

  const screenshots: string[] = [];
  if (body.screenshots !== undefined) {
    if (!Array.isArray(body.screenshots)) return { ok: false, error: "INVALID_SCREENSHOTS" };
    if (body.screenshots.length > MAX_SCREENSHOTS) return { ok: false, error: "TOO_MANY_SCREENSHOTS" };
    for (const item of body.screenshots) {
      const canonical = imageUrl(item);
      if (!canonical) return { ok: false, error: "INVALID_SCREENSHOT" };
      if (!screenshots.includes(canonical)) screenshots.push(canonical);
    }
  }

  let source: SourceInput = { kind: "none" };
  if (body.source !== undefined && body.source !== null) {
    if (!isRecord(body.source)) return { ok: false, error: "INVALID_SOURCE" };
    const mode = body.source.mode;
    if (mode === "upload") {
      const url = canonicalBlobUrl(body.source.url, "game");
      if (!url) return { ok: false, error: "INVALID_UPLOADED_FILE" };
      // Android content is APK only; the extension is checked on the stored pathname, not the browser MIME type.
      const unchanged = options.unchangedSourceUrl ? canonicalBlobUrl(options.unchangedSourceUrl, "game") === url : false;
      if (platform === "ANDROID" && !unchanged && !new URL(url).pathname.toLowerCase().endsWith(".apk")) {
        return { ok: false, error: "APK_FILE_REQUIRED" };
      }
      source = { kind: "upload", url };
    } else if (mode === "link") {
      const url = normalizeExternalSourceUrl(body.source.url);
      if (!url) return { ok: false, error: "INVALID_APK_LINK" };
      source = { kind: "link", url };
    } else {
      return { ok: false, error: "INVALID_SOURCE" };
    }
  }

  return {
    ok: true,
    value: {
      type: body.type,
      name,
      description,
      platform,
      isMod: body.isMod === true,
      published: body.published === true,
      mainImage,
      screenshots,
      source,
    },
  };
}

export function sourceStatusFor(source: SourceInput) {
  return source.kind === "none" ? "NEEDS_SOURCE" : DEFAULT_UPLOAD_SOURCE_STATUS;
}

export function sourceProviderFor(source: SourceInput) {
  if (source.kind === "upload") return "GameVortex Blob";
  if (source.kind === "link") return "External link";
  return null;
}

/** Unique slug per table: name -> name, name-2, name-3 ... Falls back to a random id for non-latin names. */
export async function uniqueSlug(type: ContentType, name: string) {
  const base = slugify(name, 80) || `${type}-${crypto.randomUUID().slice(0, 8)}`;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const taken =
      type === "game"
        ? await prisma.game.findUnique({ where: { slug: candidate }, select: { id: true } })
        : await prisma.app.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  return `${base}-${crypto.randomUUID().slice(0, 6)}`;
}

/** Everything a stored item references in Blob, used to clean up replaced/removed files after an edit. */
export function storedBlobUrls(item: {
  downloadSource: string | null;
  coverUrl: string | null;
  iconUrl?: string | null;
  screenshots: string[];
}) {
  return [item.downloadSource, item.coverUrl, item.iconUrl ?? null, ...item.screenshots].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
}

function sourceFromStored(downloadSource: string | null): ContentFormData["source"] {
  if (!downloadSource) return null;
  const isBlob = canonicalBlobUrl(downloadSource, "game") !== null;
  const mode: SourceMode = isBlob ? "upload" : "link";
  return { mode, url: downloadSource };
}

/** Loads one item in the shape the form uses. Returns null when not found. */
export async function loadContentForm(type: ContentType, id: string): Promise<ContentFormData | null> {
  if (type === "game") {
    const game = await prisma.game.findUnique({
      where: { id },
      select: {
        id: true, titleAr: true, description: true, platform: true, isMod: true, published: true,
        coverUrl: true, screenshots: true, downloadSource: true,
        gamePlatforms: { select: { platform: true }, orderBy: { createdAt: "asc" } },
      },
    });
    if (!game) return null;
    return {
      id: game.id,
      type,
      name: game.titleAr,
      description: game.description ?? "",
      platform: game.gamePlatforms[0]?.platform ?? game.platform?.split(",")[0] ?? "ANDROID",
      isMod: game.isMod,
      published: game.published,
      mainImage: game.coverUrl,
      screenshots: game.screenshots,
      source: sourceFromStored(game.downloadSource),
    };
  }

  const app = await prisma.app.findUnique({
    where: { id },
    select: {
      id: true, nameAr: true, descriptionAr: true, isMod: true, published: true,
      coverUrl: true, iconUrl: true, screenshots: true, downloadSource: true,
      appPlatforms: { select: { platform: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!app) return null;
  return {
    id: app.id,
    type,
    name: app.nameAr,
    description: app.descriptionAr ?? "",
    platform: app.appPlatforms[0]?.platform ?? "ANDROID",
    isMod: app.isMod,
    published: app.published,
    mainImage: app.coverUrl ?? app.iconUrl,
    screenshots: app.screenshots,
    source: sourceFromStored(app.downloadSource),
  };
}

/** Flat view of a stored item used by the update route (same shape for games and apps). */
export type ExistingContent = {
  name: string;
  description: string | null;
  downloadSource: string | null;
  coverUrl: string | null;
  iconUrl: string | null;
  screenshots: string[];
  platforms: PlatformType[];
};

export async function loadExistingContent(type: ContentType, id: string): Promise<ExistingContent | null> {
  if (type === "game") {
    const game = await prisma.game.findUnique({
      where: { id },
      select: {
        titleAr: true, description: true, downloadSource: true, coverUrl: true, screenshots: true,
        gamePlatforms: { select: { platform: true } },
      },
    });
    if (!game) return null;
    return {
      name: game.titleAr,
      description: game.description,
      downloadSource: game.downloadSource,
      coverUrl: game.coverUrl,
      iconUrl: null,
      screenshots: game.screenshots,
      platforms: game.gamePlatforms.map((item) => item.platform),
    };
  }

  const app = await prisma.app.findUnique({
    where: { id },
    select: {
      nameAr: true, descriptionAr: true, downloadSource: true, coverUrl: true, iconUrl: true, screenshots: true,
      appPlatforms: { select: { platform: true } },
    },
  });
  if (!app) return null;
  return {
    name: app.nameAr,
    description: app.descriptionAr,
    downloadSource: app.downloadSource,
    coverUrl: app.coverUrl,
    iconUrl: app.iconUrl,
    screenshots: app.screenshots,
    platforms: app.appPlatforms.map((item) => item.platform),
  };
}
