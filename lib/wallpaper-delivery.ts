import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { isVercelBlobUrl } from "./wallpaper-constants";

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".apng": "image/apng",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

function localPublicFilePath(url: string) {
  if (!url.startsWith("/wallpapers/") || url.includes("..") || url.includes("\0")) return null;
  const publicRoot = path.resolve(process.cwd(), "public");
  const filePath = path.resolve(publicRoot, url.replace(/^\/+/, ""));
  return filePath.startsWith(`${publicRoot}${path.sep}`) ? filePath : null;
}

function configuredOrigin() {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "") ||
    "http://127.0.0.1:3000";
  return raw.replace(/\/+$/, "");
}

export async function openWallpaperSource(url: string) {
  if (!url) throw new Error("IMAGE_SOURCE_MISSING");

  if (url.startsWith("/wallpapers/")) {
    const filePath = localPublicFilePath(url);
    if (!filePath) throw new Error("LOCAL_IMAGE_PATH_INVALID");
    try {
      const info = await stat(/* turbopackIgnore: true */ filePath);
      if (info.isFile()) {
        return {
          stream: Readable.toWeb(createReadStream(/* turbopackIgnore: true */ filePath)) as unknown as ReadableStream<Uint8Array>,
          contentType: CONTENT_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
          contentLength: info.size,
        };
      }
    } catch {
      // Not on local disk (e.g. serverless bundle): fall back to the site's own public URL.
    }
    const response = await fetch(`${configuredOrigin()}${url}`, { cache: "no-store" });
    if (!response.ok || !response.body) throw new Error("LOCAL_IMAGE_NOT_FOUND");
    return {
      stream: response.body,
      contentType: response.headers.get("content-type") || "application/octet-stream",
      contentLength: Number(response.headers.get("content-length") || 0) || undefined,
    };
  }

  if (!/^https:\/\//i.test(url)) throw new Error("IMAGE_SOURCE_UNSUPPORTED");
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) throw new Error("IMAGE_SOURCE_FETCH_FAILED");
  return {
    stream: response.body,
    contentType: response.headers.get("content-type") || "application/octet-stream",
    contentLength: Number(response.headers.get("content-length") || 0) || undefined,
  };
}

export { isVercelBlobUrl };
