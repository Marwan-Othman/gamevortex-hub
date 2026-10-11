import {
  DISTRIBUTABLE_SOURCE_STATUSES,
  isVercelBlobHostname,
} from "@/lib/game-upload-shared";
import { normalizeExternalSourceUrl } from "@/lib/content-admin";

/**
 * Single source of truth for "can this game/app be downloaded, and from where".
 * Used by /download/game/[slug], /download/app/[slug], the detail pages and every public API
 * that returns a game or an app.
 */

export function isDistributableStatus(status: string | null | undefined): boolean {
  return (DISTRIBUTABLE_SOURCE_STATUSES as readonly string[]).includes(status ?? "");
}

function isBlobUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && isVercelBlobHostname(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Returns the URL the browser may be redirected to, or null when the stored value is not safe.
 * Blob URLs lose their query/hash; external links keep their query (some hosts need it).
 */
export function resolveDownloadUrl(source: string | null | undefined): string | null {
  if (!source) return null;
  if (isBlobUrl(source)) {
    const url = new URL(source);
    url.search = "";
    url.hash = "";
    return url.toString();
  }
  return normalizeExternalSourceUrl(source);
}

/** True when the item has a safe download source AND its source status allows public distribution. */
export function canDownload(item: { downloadSource?: string | null; sourceStatus?: string | null }): boolean {
  return isDistributableStatus(item.sourceStatus) && resolveDownloadUrl(item.downloadSource) !== null;
}

/**
 * Public API view of a game/app: the raw file URL never leaves the server, so the download
 * counter and the distribution-status check in /download/* cannot be bypassed.
 * Clients use `hasDownload` and link to /download/game/<slug> or /download/app/<slug>.
 */
export function toPublicContent<T extends { downloadSource?: string | null; sourceStatus?: string | null }>(
  item: T,
): Omit<T, "downloadSource"> & { hasDownload: boolean } {
  const { downloadSource: _omitted, ...rest } = item;
  return { ...rest, hasDownload: canDownload(item) };
}
