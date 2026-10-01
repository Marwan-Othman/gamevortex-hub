import { del, put } from "@vercel/blob";
import {
  WALLPAPER_ANIMATED_MIME_TYPES,
  WALLPAPER_IMAGE_MIME_TYPES,
  WALLPAPER_MAX_FILE_SIZE,
} from "./wallpaper-constants";

export { WALLPAPER_ANIMATED_MIME_TYPES, WALLPAPER_IMAGE_MIME_TYPES, WALLPAPER_MAX_FILE_SIZE };
export {
  isAnimatedWallpaperMimeType,
  isSupportedWallpaperMimeType,
  isVercelBlobUrl,
  sanitizeWallpaperFilename,
} from "./wallpaper-constants";

export async function storeWallpaperFile({
  pathname,
  file,
  contentType,
}: {
  pathname: string;
  file: Blob | ArrayBuffer | ReadableStream<Uint8Array>;
  contentType: string;
}) {
  return put(pathname, file, {
    access: "public",
    addRandomSuffix: true,
    contentType,
    cacheControlMaxAge: 31536000,
  });
}

export async function deleteWallpaperStoredFile(url: string | null | undefined) {
  if (!url || !isVercelBlobUrl(url)) return;
  try {
    await del(url);
  } catch (error) {
    console.error("Failed to delete wallpaper Blob object:", error);
  }
}

export function filenameFromUrl(value: string, fallback = "wallpaper") {
  try {
    const url = new URL(value);
    const last = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || "");
    return sanitizeWallpaperFilename(last || fallback);
  } catch {
    return sanitizeWallpaperFilename(fallback);
  }
}

export async function validateRemoteBlobImage(url: string, expectedMime?: string, expectedSize?: number) {
  if (!isVercelBlobUrl(url)) throw new Error("INVALID_BLOB_URL");
  const res = await fetch(url, { method: "GET", redirect: "follow" });
  if (!res.ok) throw new Error("BLOB_VALIDATION_FAILED");
  const mime = (res.headers.get("content-type") || "").split(";",1)[0].trim().toLowerCase();
  if (!isSupportedWallpaperMimeType(mime)) throw new Error("IMAGE_SOURCE_TYPE_NOT_SUPPORTED");
  if (expectedMime && mime !== expectedMime.toLowerCase()) throw new Error("IMAGE_MIME_MISMATCH");
  const lengthHeader = Number(res.headers.get("content-length") || 0);
  if (expectedSize && lengthHeader && Math.abs(lengthHeader - expectedSize) > 1024) throw new Error("IMAGE_SIZE_MISMATCH");
  if (lengthHeader > WALLPAPER_MAX_FILE_SIZE) throw new Error("IMAGE_FILE_TOO_LARGE");
  return { mimeType: mime, size: lengthHeader || expectedSize || 0 };
}
