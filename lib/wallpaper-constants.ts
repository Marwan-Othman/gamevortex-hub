export const WALLPAPER_MAX_FILE_SIZE = 50 * 1024 * 1024;
export const WALLPAPER_BULK_UPLOAD_MAX = 100;
export const WALLPAPER_BULK_DOWNLOAD_MAX = 100;
export const WALLPAPER_BULK_DOWNLOAD_MAX_BYTES = 1024 * 1024 * 1024;

export const WALLPAPER_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/apng",
  "image/avif",
] as const;

export const WALLPAPER_ANIMATED_MIME_TYPES = [
  "image/gif",
  "image/webp",
  "image/apng",
] as const;

export function isSupportedWallpaperMimeType(value: unknown): value is (typeof WALLPAPER_IMAGE_MIME_TYPES)[number] {
  return typeof value === "string" &&
    (WALLPAPER_IMAGE_MIME_TYPES as readonly string[]).includes(value.toLowerCase());
}

export function isAnimatedWallpaperMimeType(value: unknown): boolean {
  return typeof value === "string" &&
    (WALLPAPER_ANIMATED_MIME_TYPES as readonly string[]).includes(value.toLowerCase());
}

export function sanitizeWallpaperFilename(value: string): string {
  const normalized = value.normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 120);
  return normalized || "wallpaper";
}

export function isVercelBlobUrl(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.endsWith(".blob.vercel-storage.com");
  } catch {
    return false;
  }
}
