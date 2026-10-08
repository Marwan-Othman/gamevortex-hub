/**
 * Pure helpers shared by the admin game-upload UI and the server routes.
 * No server-only imports here: this module is bundled into client components.
 */

export type UploadKind = "game" | "mod" | "cover";

export type UploadPlatform =
  | "PC"
  | "PLAYSTATION"
  | "XBOX"
  | "NINTENDO"
  | "ANDROID"
  | "IOS"
  | "MAC"
  | "LINUX"
  | "STEAM_DECK"
  | "WEB";

/** Order matters: longer / compound extensions must come before their suffixes. */
export const GAME_EXTENSIONS = [
  ".tar.gz",
  ".appimage",
  ".apk",
  ".aab",
  ".exe",
  ".msi",
  ".zip",
  ".7z",
  ".rar",
  ".iso",
  ".img",
  ".dmg",
  ".pkg",
  ".deb",
  ".tar",
  ".tgz",
  ".gz",
  ".obb",
] as const;

export type GameExtension = (typeof GAME_EXTENSIONS)[number];

export const GAME_FILE_ACCEPT = [...GAME_EXTENSIONS].join(",");

export const COVER_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const;

/**
 * Game/Mod files are always uploaded with this content type. Mobile browsers report
 * inconsistent MIME types for .apk/.rar/.deb/.pkg, so we pin one safe type instead of
 * trusting file.type. The extension is validated separately.
 */
export const GAME_BLOB_CONTENT_TYPE = "application/octet-stream";

/**
 * Real content type per extension, chosen by us (never trusted from the browser).
 * Vercel Blob's CDN compresses `application/octet-stream` on the fly for browsers that send
 * Accept-Encoding; the compressed response has no Content-Length, so Chrome shows "?" as the
 * total size. Specific archive/package types are served as-is, with Content-Length.
 */
export const GAME_CONTENT_TYPE_BY_EXTENSION: Record<GameExtension, string> = {
  ".tar.gz": "application/gzip",
  ".tgz": "application/gzip",
  ".gz": "application/gzip",
  ".tar": "application/x-tar",
  ".appimage": GAME_BLOB_CONTENT_TYPE,
  ".apk": "application/vnd.android.package-archive",
  ".aab": GAME_BLOB_CONTENT_TYPE,
  ".obb": GAME_BLOB_CONTENT_TYPE,
  ".exe": "application/vnd.microsoft.portable-executable",
  ".msi": "application/x-msi",
  ".zip": "application/zip",
  ".7z": "application/x-7z-compressed",
  ".rar": "application/vnd.rar",
  ".iso": "application/x-iso9660-image",
  ".img": GAME_BLOB_CONTENT_TYPE,
  ".dmg": "application/x-apple-diskimage",
  ".pkg": "application/x-newton-compatible-pkg",
  ".deb": "application/vnd.debian.binary-package",
};

export function gameContentTypeFor(fileName: string): string {
  const extension = getGameExtension(fileName);
  return extension ? GAME_CONTENT_TYPE_BY_EXTENSION[extension] : GAME_BLOB_CONTENT_TYPE;
}

export const BLOB_FOLDERS: Record<UploadKind, string> = {
  game: "games/files/",
  mod: "games/mods/",
  cover: "games/covers/",
};

export const MAX_GAMES_PER_BATCH = 100;
export const UPLOAD_CONCURRENCY = 3;
export const MAX_GAME_FILE_SIZE = 50 * 1024 * 1024 * 1024;
export const MAX_COVER_FILE_SIZE = 15 * 1024 * 1024;

/** Source statuses that allow public distribution. Mirrors app/download/game/[slug]/route.ts. */
export const DISTRIBUTABLE_SOURCE_STATUSES = [
  "OFFICIAL_SOURCE",
  "LICENSED_FOR_DISTRIBUTION",
  "OPEN_SOURCE",
  "FREEWARE_REDISTRIBUTABLE",
] as const;

export type DistributableSourceStatus = (typeof DISTRIBUTABLE_SOURCE_STATUSES)[number];

export const DEFAULT_UPLOAD_SOURCE_STATUS: DistributableSourceStatus = "LICENSED_FOR_DISTRIBUTION";

/** For uploaded files only distributable statuses are accepted; anything else falls back to the default. */
export function normalizeUploadSourceStatus(value: unknown): DistributableSourceStatus {
  return DISTRIBUTABLE_SOURCE_STATUSES.find((status) => status === value) ?? DEFAULT_UPLOAD_SOURCE_STATUS;
}

export function getGameExtension(fileName: string): GameExtension | "" {
  const lower = fileName.trim().toLowerCase();
  return GAME_EXTENSIONS.find((extension) => lower.endsWith(extension)) ?? "";
}

export function hasAllowedGameExtension(fileName: string): boolean {
  return getGameExtension(fileName) !== "";
}

export function platformFromFileName(fileName: string): UploadPlatform {
  switch (getGameExtension(fileName)) {
    case ".apk":
    case ".aab":
    case ".obb":
      return "ANDROID";
    case ".dmg":
    case ".pkg":
      return "MAC";
    case ".deb":
    case ".appimage":
      return "LINUX";
    default:
      return "PC";
  }
}

export function titleFromFileName(fileName: string): string {
  const extension = getGameExtension(fileName);
  const base = extension ? fileName.trim().slice(0, -extension.length) : fileName.trim();
  const title = base.replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim();
  return title || "Game";
}

export function slugify(value: string, maxLength = 90): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, maxLength);
}

/** Filename that is safe to embed in a Blob pathname. */
export function safeBlobFileName(fileName: string): string {
  const cleaned = fileName
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+/, "");
  const tail = cleaned.slice(-160);
  // Make sure truncation did not remove the extension we validate later.
  return hasAllowedGameExtension(tail) || !hasAllowedGameExtension(fileName)
    ? tail || "file"
    : "file" + (getGameExtension(fileName) || "");
}

/**
 * The unique part lives in its own "folder" (<timestamp>-<id>/) so the Blob basename stays the
 * clean original file name. Browsers use that basename as the saved file name when the
 * download URL carries ?download=1.
 */
export function buildBlobPathname(kind: UploadKind, fileName: string, uniqueId: string): string {
  return `${BLOB_FOLDERS[kind]}${Date.now()}-${uniqueId}/${safeBlobFileName(fileName)}`;
}

export function isVercelBlobHostname(hostname: string): boolean {
  return hostname.toLowerCase().endsWith(".blob.vercel-storage.com");
}

/** Pathname rules enforced by the token endpoint (before upload) and by the DB routes (after). */
export function isValidBlobPathname(pathname: string, kind: UploadKind): boolean {
  const value = pathname.trim();
  if (!value) return false;
  if (value.startsWith("/") || value.includes("..") || value.includes("\\") || value.includes("\0")) return false;
  if (value.includes("//")) return false;
  if (!value.startsWith(BLOB_FOLDERS[kind])) return false;
  if (kind === "cover") return true;
  return hasAllowedGameExtension(value);
}

/**
 * Validates a Blob URL for a given kind and returns its canonical form
 * (query string and hash removed, so `?download=1` is never persisted).
 * Returns null when the URL is not an acceptable GameVortex Blob URL.
 */
export function canonicalBlobUrl(value: unknown, kind: UploadKind): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !isVercelBlobHostname(url.hostname)) return null;
  if (url.username || url.password) return null;

  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  } catch {
    return null;
  }
  if (!isValidBlobPathname(pathname, kind)) return null;
  return `${url.origin}${url.pathname}`;
}

export type OwnerUploadFileIssue = "UNSUPPORTED_EXTENSION" | "EMPTY_FILE" | "TOO_LARGE";

export function checkGameFile(file: { name: string; size: number }): OwnerUploadFileIssue | null {
  if (!hasAllowedGameExtension(file.name)) return "UNSUPPORTED_EXTENSION";
  if (!Number.isFinite(file.size) || file.size <= 0) return "EMPTY_FILE";
  if (file.size > MAX_GAME_FILE_SIZE) return "TOO_LARGE";
  return null;
}

/** Makes unique slugs inside a batch: game, game-2, game-3... */
export function dedupeSlugs(bases: readonly string[], taken: ReadonlySet<string> = new Set()): string[] {
  const used = new Set(taken);
  return bases.map((raw, index) => {
    const base = raw || `game-${index + 1}`;
    let slug = base;
    let suffix = 2;
    while (used.has(slug)) {
      slug = `${base}-${suffix}`;
      suffix += 1;
    }
    used.add(slug);
    return slug;
  });
}

export const UPLOAD_PLATFORM_OPTIONS: readonly (readonly [UploadPlatform, string])[] = [
  ["PC", "PC"],
  ["ANDROID", "Android"],
  ["IOS", "iPhone / iPad"],
  ["PLAYSTATION", "PlayStation"],
  ["XBOX", "Xbox"],
  ["NINTENDO", "Nintendo"],
  ["MAC", "macOS"],
  ["LINUX", "Linux"],
  ["STEAM_DECK", "Steam Deck"],
  ["WEB", "Web"],
];

export function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = value;
  let index = -1;
  do {
    size /= 1024;
    index += 1;
  } while (size >= 1024 && index < units.length - 1);
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[index]}`;
}
