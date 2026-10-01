/**
 * GameVortex Hub
 * Wallpaper utilities
 *
 * Simplified wallpaper system:
 *
 * Required:
 * - imageUrl
 *
 * Optional:
 * - titleAr
 * - titleEn
 * - slug
 * - descriptions
 * - thumbnail
 * - download URL
 * - source / license information
 * - category / tags
 * - dimensions
 *
 * Main admin flags:
 * - isVip
 * - published
 * - featured
 *
 * Publishing a wallpaper does NOT require:
 * - sourceUrl
 * - licenseUrl
 * - attribution
 * - sourceStatus verification
 *
 * The only required validation for the image itself is:
 * - HTTPS URL
 * - non-empty
 * - not a local/example host
 */

/* -------------------------------------------------------------------------- */
/* Source statuses                                                            */
/* -------------------------------------------------------------------------- */

export const WALLPAPER_SOURCE_STATUSES = [
  "VERIFIED",
  "LICENSED_FOR_DISTRIBUTION",
  "OPEN_SOURCE",
  "FREEWARE_REDISTRIBUTABLE",
  "STREAM_ONLY",
  "OFFICIAL_SOURCE",
  "NEEDS_SOURCE",
  "NEEDS_LICENSE",
  "PENDING_REVIEW",
  "UNPUBLISHED",
] as const;

export type WallpaperSourceStatus =
  (typeof WALLPAPER_SOURCE_STATUSES)[number];

/* -------------------------------------------------------------------------- */
/* Wallpaper types                                                            */
/* -------------------------------------------------------------------------- */

export const WALLPAPER_TYPES = [
  "DESKTOP",
  "MOBILE",
] as const;

export type WallpaperType =
  (typeof WALLPAPER_TYPES)[number];

/* -------------------------------------------------------------------------- */
/* Orientation                                                                */
/* -------------------------------------------------------------------------- */

export const WALLPAPER_ORIENTATIONS = [
  "LANDSCAPE",
  "PORTRAIT",
  "SQUARE",
] as const;

export type WallpaperOrientation =
  (typeof WALLPAPER_ORIENTATIONS)[number];

/* -------------------------------------------------------------------------- */
/* Categories                                                                 */
/* -------------------------------------------------------------------------- */

export const WALLPAPER_CATEGORIES = [
  "GAMING",
  "CYBERPUNK",
  "SCI_FI",
  "FANTASY",
  "ABSTRACT",
  "NATURE",
  "ANIME",
  "MINIMAL",
  "SPACE",
  "NEON",
  "GAMEVORTEX",
  "OTHER",
] as const;

export type WallpaperCategory =
  (typeof WALLPAPER_CATEGORIES)[number];

/* -------------------------------------------------------------------------- */
/* Verification result                                                        */
/* -------------------------------------------------------------------------- */

export type WallpaperVerificationResult = {
  valid: boolean;
  reason?: string;
};

/* -------------------------------------------------------------------------- */
/* Wallpaper input                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Most fields are optional now.
 *
 * imageUrl is the only required field.
 *
 * This allows the admin UI to create a wallpaper using:
 *
 * imageUrl
 * isVip
 * published
 * featured
 *
 * without forcing source/license/category/title metadata.
 */
export type WallpaperInput = {
  titleAr?: string | null;
  titleEn?: string | null;
  slug?: string | null;

  descriptionAr?: string | null;
  descriptionEn?: string | null;

  imageUrl: string;

  originalFilename?: string | null;
  mimeType?: string | null;
  fileSizeBytes?: number | bigint | null;
  isAnimated?: boolean;

  thumbnailUrl?: string | null;
  downloadUrl?: string | null;

  sourceUrl?: string | null;
  sourceProvider?: string | null;

  licenseUrl?: string | null;
  licenseStatus?: string | null;
  attribution?: string | null;

  sourceStatus?: WallpaperSourceStatus | string | null;

  type?: WallpaperType | string | null;
  orientation?: WallpaperOrientation | string | null;
  category?: WallpaperCategory | string | null;

  deviceType?: string | null;
  resolution?: string | null;

  width?: number | null;
  height?: number | null;

  tags?: string[] | null;

  published?: boolean;
  featured?: boolean;
  isVip?: boolean;

  sortOrder?: number | null;
};

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const MAX_TITLE_LENGTH = 160;
const MAX_DESCRIPTION_LENGTH = 5000;
const MAX_PROVIDER_LENGTH = 160;
const MAX_LICENSE_STATUS_LENGTH = 120;
const MAX_ATTRIBUTION_LENGTH = 1000;
const MAX_TAG_LENGTH = 50;
const MAX_TAGS = 30;
const MAX_RESOLUTION_LENGTH = 60;
const MAX_DEVICE_TYPE_LENGTH = 40;

/**
 * Hosts that must never be accepted as public image URLs.
 */
const BLOCKED_HOSTS = new Set([
  "example.com",
  "example.org",
  "example.net",
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
]);

const BLOCKED_HOST_SUFFIXES = [
  ".local",
  ".localhost",
];

/* -------------------------------------------------------------------------- */
/* Generic helpers                                                            */
/* -------------------------------------------------------------------------- */

function cleanString(
  value: unknown,
  maxLength: number,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const cleaned = value.trim();

  if (!cleaned) {
    return null;
  }

  return cleaned.slice(0, maxLength);
}

function cleanRequiredString(
  value: unknown,
  fieldName: string,
  maxLength: number,
): string {
  const cleaned = cleanString(value, maxLength);

  if (!cleaned) {
    throw new Error(`${fieldName.toUpperCase()}_REQUIRED`);
  }

  return cleaned;
}

/* -------------------------------------------------------------------------- */
/* URL validation                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Validate a public HTTPS URL.
 *
 * We intentionally keep this strict enough to prevent accidental
 * localhost/example URLs, while allowing normal image/CDN hosts.
 */
export function isHttpsUrl(
  value: unknown,
): boolean {
  if (typeof value !== "string") {
    return false;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return false;
  }

  try {
    const url = new URL(trimmed);

    if (url.protocol !== "https:") {
      return false;
    }

    const hostname = url.hostname.toLowerCase();

    if (BLOCKED_HOSTS.has(hostname)) {
      return false;
    }

    if (
      BLOCKED_HOST_SUFFIXES.some((suffix) =>
        hostname.endsWith(suffix),
      )
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Return a normalized HTTPS URL or null.
 */
export function normalizeHttpsUrl(
  value: unknown,
): string | null {
  if (!isHttpsUrl(value)) {
    return null;
  }

  return String(value).trim();
}

/**
 * Require an HTTPS URL.
 *
 * This is primarily used for imageUrl because that is the
 * only required URL in the simplified wallpaper system.
 */
export function requireHttpsUrl(
  value: unknown,
  fieldName: string,
): string {
  const url = normalizeHttpsUrl(value);

  if (!url) {
    throw new Error(
      `${fieldName.toUpperCase()}_MUST_BE_HTTPS`,
    );
  }

  return url;
}

/* -------------------------------------------------------------------------- */
/* Slug                                                                       */
/* -------------------------------------------------------------------------- */

export function slugifyWallpaper(
  value: string,
): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160);
}

/**
 * Generate a usable slug.
 *
 * Since title is now optional, imageUrl can also be used as
 * a fallback when needed.
 */
export function normalizeWallpaperSlug(
  value: unknown,
  fallbackTitle?: string,
): string {
  const provided =
    typeof value === "string"
      ? slugifyWallpaper(value)
      : "";

  if (provided) {
    return provided;
  }

  const fallback =
    typeof fallbackTitle === "string"
      ? slugifyWallpaper(fallbackTitle)
      : "";

  if (fallback) {
    return fallback;
  }

  /**
   * Keep compatibility with callers that expect a slug.
   *
   * The admin API may replace this with a unique slug if needed.
   */
  return `wallpaper-${Date.now()}`;
}

/* -------------------------------------------------------------------------- */
/* Enum normalization                                                         */
/* -------------------------------------------------------------------------- */

export function normalizeWallpaperSourceStatus(
  value: unknown,
): WallpaperSourceStatus {
  if (
    typeof value === "string" &&
    (
      WALLPAPER_SOURCE_STATUSES as readonly string[]
    ).includes(value)
  ) {
    return value as WallpaperSourceStatus;
  }

  return "NEEDS_SOURCE";
}

export function normalizeWallpaperType(
  value: unknown,
): WallpaperType {
  if (
    typeof value === "string" &&
    (
      WALLPAPER_TYPES as readonly string[]
    ).includes(value)
  ) {
    return value as WallpaperType;
  }

  return "DESKTOP";
}

export function normalizeWallpaperOrientation(
  value: unknown,
): WallpaperOrientation {
  if (
    typeof value === "string" &&
    (
      WALLPAPER_ORIENTATIONS as readonly string[]
    ).includes(value)
  ) {
    return value as WallpaperOrientation;
  }

  return "LANDSCAPE";
}

export function normalizeWallpaperCategory(
  value: unknown,
): WallpaperCategory {
  if (
    typeof value === "string" &&
    (
      WALLPAPER_CATEGORIES as readonly string[]
    ).includes(value)
  ) {
    return value as WallpaperCategory;
  }

  return "OTHER";
}

/* -------------------------------------------------------------------------- */
/* Tags                                                                       */
/* -------------------------------------------------------------------------- */

export function normalizeWallpaperTags(
  value: unknown,
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: string[] = [];
  const seen = new Set<string>();

  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }

    const tag = item
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, MAX_TAG_LENGTH);

    if (!tag) {
      continue;
    }

    const key = tag.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(tag);

    if (result.length >= MAX_TAGS) {
      break;
    }
  }

  return result;
}

/* -------------------------------------------------------------------------- */
/* Dimensions                                                                 */
/* -------------------------------------------------------------------------- */

export function normalizeWallpaperDimension(
  value: unknown,
): number | null {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value)
  ) {
    return null;
  }

  const integer = Math.round(value);

  if (integer <= 0) {
    return null;
  }

  if (integer > 100000) {
    return null;
  }

  return integer;
}

/* -------------------------------------------------------------------------- */
/* Source verification                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Kept for backwards compatibility.
 *
 * IMPORTANT:
 * This is no longer required for publishing.
 *
 * It can still be used by other parts of the project when they
 * want to know whether a source status represents a verified source.
 */
export function isVerifiedWallpaperSource(
  status: unknown,
): boolean {
  return (
    status === "VERIFIED" ||
    status === "LICENSED_FOR_DISTRIBUTION" ||
    status === "OPEN_SOURCE" ||
    status === "FREEWARE_REDISTRIBUTABLE" ||
    status === "OFFICIAL_SOURCE"
  );
}

/**
 * Simplified publishing validation.
 *
 * OLD behavior:
 * image + verified source + source URL + sometimes license URL
 *
 * NEW behavior:
 * image URL only.
 *
 * Source/license metadata remains optional and can still be
 * stored when available.
 */
export function canPublishWallpaper(
  input: {
    imageUrl?: unknown;
    sourceStatus?: unknown;
    sourceUrl?: unknown;
    licenseUrl?: unknown;
  },
): WallpaperVerificationResult {
  if (!isHttpsUrl(input.imageUrl)) {
    return {
      valid: false,
      reason: "IMAGE_URL_MUST_BE_HTTPS",
    };
  }

  return {
    valid: true,
  };
}

/* -------------------------------------------------------------------------- */
/* Main input normalization                                                   */
/* -------------------------------------------------------------------------- */

export function normalizeWallpaperInput(
  input: WallpaperInput,
) {
  /**
   * imageUrl is the only required field.
   */
  const imageUrl = requireHttpsUrl(
    input.imageUrl,
    "imageUrl",
  );

  /**
   * Titles are optional now.
   */
  const titleAr =
    cleanString(
      input.titleAr,
      MAX_TITLE_LENGTH,
    ) ?? "";

  const titleEn =
    cleanString(
      input.titleEn,
      MAX_TITLE_LENGTH,
    ) ?? "";

  /**
   * Optional URLs.
   *
   * Invalid optional URLs are converted to null instead
   * of preventing the wallpaper from being created.
   */
  const thumbnailUrl =
    input.thumbnailUrl == null
      ? null
      : normalizeHttpsUrl(input.thumbnailUrl);

  const downloadUrl =
    input.downloadUrl == null
      ? null
      : normalizeHttpsUrl(input.downloadUrl);

  const sourceUrl =
    input.sourceUrl == null
      ? null
      : normalizeHttpsUrl(input.sourceUrl);

  const licenseUrl =
    input.licenseUrl == null
      ? null
      : normalizeHttpsUrl(input.licenseUrl);

  const sourceStatus =
    normalizeWallpaperSourceStatus(
      input.sourceStatus,
    );

  const type =
    normalizeWallpaperType(input.type);

  const orientation =
    normalizeWallpaperOrientation(
      input.orientation,
    );

  const category =
    normalizeWallpaperCategory(
      input.category,
    );

  /**
   * Slug can now be generated without a title.
   */
  const slug =
    normalizeWallpaperSlug(
      input.slug,
      titleEn || titleAr,
    );

  const descriptionAr =
    cleanString(
      input.descriptionAr,
      MAX_DESCRIPTION_LENGTH,
    );

  const descriptionEn =
    cleanString(
      input.descriptionEn,
      MAX_DESCRIPTION_LENGTH,
    );

  const sourceProvider =
    cleanString(
      input.sourceProvider,
      MAX_PROVIDER_LENGTH,
    );

  const licenseStatus =
    cleanString(
      input.licenseStatus,
      MAX_LICENSE_STATUS_LENGTH,
    );

  const attribution =
    cleanString(
      input.attribution,
      MAX_ATTRIBUTION_LENGTH,
    );

  const deviceType =
    cleanString(
      input.deviceType,
      MAX_DEVICE_TYPE_LENGTH,
    );

  const resolution =
    cleanString(
      input.resolution,
      MAX_RESOLUTION_LENGTH,
    );

  const tags =
    normalizeWallpaperTags(
      input.tags,
    );

  const width =
    normalizeWallpaperDimension(
      input.width,
    );

  const height =
    normalizeWallpaperDimension(
      input.height,
    );

  const sortOrder =
    typeof input.sortOrder === "number" &&
    Number.isFinite(input.sortOrder)
      ? Math.max(
          0,
          Math.min(
            100000,
            Math.round(input.sortOrder),
          ),
        )
      : 0;

  /**
   * Main admin flags.
   */
  const published =
    input.published === true;

  const featured =
    input.featured === true;

  const isVip =
    input.isVip === true;

  return {
    titleAr,
    titleEn,
    slug,

    descriptionAr,
    descriptionEn,

    imageUrl,

    originalFilename: cleanString(input.originalFilename, 160),
    mimeType: cleanString(input.mimeType, 120),
    fileSizeBytes: typeof input.fileSizeBytes === "bigint" ? input.fileSizeBytes : typeof input.fileSizeBytes === "number" && Number.isFinite(input.fileSizeBytes) ? Math.max(0, Math.round(input.fileSizeBytes)) : null,
    isAnimated: input.isAnimated === true,

    thumbnailUrl,
    downloadUrl,

    sourceUrl,
    sourceProvider,

    licenseUrl,
    licenseStatus,
    attribution,

    sourceStatus,

    type,
    orientation,

    deviceType,
    category,

    tags,

    width,
    height,
    resolution,

    isVip,
    published,
    featured,

    sortOrder,
  };
}

/* -------------------------------------------------------------------------- */
/* Publish validation                                                         */
/* -------------------------------------------------------------------------- */

export function validateWallpaperForPublish(
  input: WallpaperInput,
): WallpaperVerificationResult {
  const normalized =
    normalizeWallpaperInput(input);

  /**
   * Publishing only requires a valid image URL.
   */
  return canPublishWallpaper({
    imageUrl: normalized.imageUrl,
    sourceUrl: normalized.sourceUrl,
    licenseUrl: normalized.licenseUrl,
    sourceStatus: normalized.sourceStatus,
  });
}

/* -------------------------------------------------------------------------- */
/* Public visibility                                                          */
/* -------------------------------------------------------------------------- */

/**
 * A wallpaper is public when:
 *
 * published === true
 *
 * Source verification is NOT required anymore.
 */
export function isWallpaperPubliclyVisible(
  input: {
    published?: boolean | null;
    sourceStatus?: string | null;
  },
): boolean {
  return input.published === true;
}

/* -------------------------------------------------------------------------- */
/* Orientation helper                                                         */
/* -------------------------------------------------------------------------- */

export function detectWallpaperOrientation(
  width: number | null | undefined,
  height: number | null | undefined,
): WallpaperOrientation {
  if (
    !width ||
    !height ||
    width <= 0 ||
    height <= 0
  ) {
    return "LANDSCAPE";
  }

  if (width === height) {
    return "SQUARE";
  }

  return width > height
    ? "LANDSCAPE"
    : "PORTRAIT";
}

/* -------------------------------------------------------------------------- */
/* Safe public representation                                                 */
/* -------------------------------------------------------------------------- */

export function toPublicWallpaper(
  wallpaper: Record<string, unknown>,
) {
  return {
    id:
      typeof wallpaper.id === "string"
        ? wallpaper.id
        : null,

    slug:
      typeof wallpaper.slug === "string"
        ? wallpaper.slug
        : null,

    titleAr:
      typeof wallpaper.titleAr === "string"
        ? wallpaper.titleAr
        : "",

    titleEn:
      typeof wallpaper.titleEn === "string"
        ? wallpaper.titleEn
        : "",

    descriptionAr:
      typeof wallpaper.descriptionAr === "string"
        ? wallpaper.descriptionAr
        : null,

    descriptionEn:
      typeof wallpaper.descriptionEn === "string"
        ? wallpaper.descriptionEn
        : null,

    imageUrl:
      typeof wallpaper.imageUrl === "string"
        ? wallpaper.imageUrl
        : null,

    originalFilename:
      typeof wallpaper.originalFilename === "string"
        ? wallpaper.originalFilename
        : null,

    mimeType:
      typeof wallpaper.mimeType === "string"
        ? wallpaper.mimeType
        : null,

    fileSizeBytes:
      typeof wallpaper.fileSizeBytes === "bigint"
        ? wallpaper.fileSizeBytes.toString()
        : typeof wallpaper.fileSizeBytes === "number"
          ? wallpaper.fileSizeBytes
          : null,

    isAnimated: wallpaper.isAnimated === true,

    thumbnailUrl:
      typeof wallpaper.thumbnailUrl === "string"
        ? wallpaper.thumbnailUrl
        : null,

    downloadUrl:
      typeof wallpaper.downloadUrl === "string"
        ? wallpaper.downloadUrl
        : null,

    sourceProvider:
      typeof wallpaper.sourceProvider === "string"
        ? wallpaper.sourceProvider
        : null,

    sourceUrl:
      typeof wallpaper.sourceUrl === "string"
        ? wallpaper.sourceUrl
        : null,

    licenseUrl:
      typeof wallpaper.licenseUrl === "string"
        ? wallpaper.licenseUrl
        : null,

    licenseStatus:
      typeof wallpaper.licenseStatus === "string"
        ? wallpaper.licenseStatus
        : null,

    attribution:
      typeof wallpaper.attribution === "string"
        ? wallpaper.attribution
        : null,

    sourceStatus:
      typeof wallpaper.sourceStatus === "string"
        ? wallpaper.sourceStatus
        : "NEEDS_SOURCE",

    type:
      typeof wallpaper.type === "string"
        ? wallpaper.type
        : "DESKTOP",

    orientation:
      typeof wallpaper.orientation === "string"
        ? wallpaper.orientation
        : "LANDSCAPE",

    deviceType:
      typeof wallpaper.deviceType === "string"
        ? wallpaper.deviceType
        : "DESKTOP",

    category:
      typeof wallpaper.category === "string"
        ? wallpaper.category
        : "OTHER",

    width:
      typeof wallpaper.width === "number"
        ? wallpaper.width
        : null,

    height:
      typeof wallpaper.height === "number"
        ? wallpaper.height
        : null,

    resolution:
      typeof wallpaper.resolution === "string"
        ? wallpaper.resolution
        : null,

    tags:
      Array.isArray(wallpaper.tags)
        ? wallpaper.tags.filter(
            (tag): tag is string =>
              typeof tag === "string",
          )
        : [],

    isVip:
      wallpaper.isVip === true,

    published:
      wallpaper.published === true,

    featured:
      wallpaper.featured === true,

    viewCount:
      typeof wallpaper.viewCount === "number"
        ? wallpaper.viewCount
        : 0,

    downloadCount:
      typeof wallpaper.downloadCount === "number"
        ? wallpaper.downloadCount
        : 0,

    createdAt:
      wallpaper.createdAt instanceof Date
        ? wallpaper.createdAt.toISOString()
        : typeof wallpaper.createdAt === "string"
          ? wallpaper.createdAt
          : null,

    updatedAt:
      wallpaper.updatedAt instanceof Date
        ? wallpaper.updatedAt.toISOString()
        : typeof wallpaper.updatedAt === "string"
          ? wallpaper.updatedAt
          : null,
  };
}
