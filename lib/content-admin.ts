/**
 * Pure helpers for the unified owner content page (/admin/content).
 * No server-only imports: this module is bundled into the client form and used by the API routes.
 */

export type ContentType = "game" | "app";
export type SourceMode = "upload" | "link";

export const CONTENT_TYPES: readonly ContentType[] = ["game", "app"];

export const MAX_SCREENSHOTS = 12;
export const MAX_NAME_LENGTH = 160;
export const MAX_DESCRIPTION_LENGTH = 8000;
export const MAX_EXTERNAL_URL_LENGTH = 2000;
export const MAX_CATEGORIES = 20;
export const MAX_VERSION_LENGTH = 40;

/** Release version such as "1.2.3", "v2.0-beta" or "19.7.0 (build 4)". Letters, digits and . _ - + ( ) space only. */
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._+()\-]*$/;

/**
 * Validates the optional release version typed by the owner.
 * undefined = field not sent (leave unchanged), null = cleared, string = cleaned value, "INVALID" = bad shape.
 */
export function parseVersionValue(value: unknown): string | null | undefined | "INVALID" {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return "INVALID";
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  if (trimmed.length > MAX_VERSION_LENGTH || !VERSION_PATTERN.test(trimmed)) return "INVALID";
  return trimmed;
}

/** An APK is a ZIP archive: it always starts with the local-file-header signature PK\x03\x04. */
export function looksLikeApk(bytes: ArrayLike<number>): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

export type DetectedImageType = "image/jpeg" | "image/png" | "image/webp" | "image/avif";

/** Detects the real image type from the first bytes (never from the file name or the browser MIME type). */
export function detectImageType(bytes: ArrayLike<number>): DetectedImageType | null {
  const at = (index: number) => bytes[index];
  const ascii = (start: number, text: string) =>
    bytes.length >= start + text.length && [...text].every((char, offset) => at(start + offset) === char.charCodeAt(0));

  if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && at(0) === 0x89 && ascii(1, "PNG") && at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a && at(7) === 0x0a) {
    return "image/png";
  }
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";
  if (ascii(4, "ftyp") && (ascii(8, "avif") || ascii(8, "avis") || ascii(8, "mif1"))) return "image/avif";
  return null;
}

/**
 * Validates the category list sent by the owner form (existing Category IDs).
 * Returns null when the field is absent (= "leave unchanged"), the cleaned unique list otherwise,
 * or "INVALID" when the shape is wrong.
 */
export function parseCategoryValues(value: unknown): string[] | null | "INVALID" {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length > MAX_CATEGORIES) return "INVALID";
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return "INVALID";
    const trimmed = item.trim();
    if (!trimmed || trimmed.length > 80) return "INVALID";
    if (!out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

export function isContentType(value: unknown): value is ContentType {
  return value === "game" || value === "app";
}

const IPV4_LITERAL = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Validates a single external APK/download link supplied by the owner.
 * Only plain https links to a public hostname are accepted; the query string is kept
 * (some hosts need it) but the hash and any credentials are rejected/removed.
 * Returns the normalized URL or null.
 */
export function normalizeExternalSourceUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw || raw.length > MAX_EXTERNAL_URL_LENGTH) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  if (url.username || url.password) return null;

  const host = url.hostname.toLowerCase();
  if (!host.includes(".") || host.startsWith("[") || host.endsWith(".local") || host.endsWith(".internal")) return null;
  if (host === "localhost" || host.endsWith(".localhost")) return null;

  if (IPV4_LITERAL.test(host)) {
    const [a, b] = host.split(".").map(Number);
    if (
      a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    ) {
      return null;
    }
  }

  url.hash = "";
  return url.toString();
}

export function isHttpsUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** Shape returned by GET /api/admin/content/[type]/[id] and used to fill the edit form. */
export type ContentFormData = {
  id: string;
  type: ContentType;
  name: string;
  description: string;
  platform: string;
  isMod: boolean;
  /** Release version typed by the owner, "" when none. */
  version: string;
  published: boolean;
  mainImage: string | null;
  screenshots: string[];
  /** Category IDs currently assigned to the item. */
  categories: string[];
  source: { mode: SourceMode; url: string } | null;
};
