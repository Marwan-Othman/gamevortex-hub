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
  published: boolean;
  mainImage: string | null;
  screenshots: string[];
  source: { mode: SourceMode; url: string } | null;
};
