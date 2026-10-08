export type ContentUploadKind = "apk" | "image";

export const CONTENT_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const;
export const APK_CONTENT_TYPES = [
  "application/vnd.android.package-archive",
  "application/octet-stream",
] as const;

export const MAX_CONTENT_APK_SIZE = 2 * 1024 * 1024 * 1024;
export const MAX_CONTENT_REMOTE_APK_SIZE = 512 * 1024 * 1024;
export const MAX_CONTENT_IMAGE_SIZE = 10 * 1024 * 1024;

export function safeContentFileName(name: string, fallback = "file") {
  const cleaned = name
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+/, "")
    .slice(-160);
  return cleaned || fallback;
}

export function contentExtension(name: string) {
  const match = /\.([a-z0-9]{1,12})$/i.exec(name.trim());
  return match?.[1]?.toLowerCase() || "";
}

export function isApkFileName(name: string) {
  return contentExtension(name) === "apk";
}

export function isImageFileName(name: string) {
  return ["jpg", "jpeg", "png", "webp", "avif"].includes(contentExtension(name));
}

export function buildContentBlobPath(kind: ContentUploadKind, fileName: string) {
  const folder = kind === "apk" ? "content/apk" : "content/images";
  const safe = safeContentFileName(fileName, kind === "apk" ? "app.apk" : "image");
  return `${folder}/${Date.now()}-${crypto.randomUUID()}/${safe}`;
}

export function canonicalContentBlobUrl(value: unknown, kind: ContentUploadKind) {
  if (typeof value !== "string" || !value.trim()) return null;
  let url: URL;
  try { url = new URL(value.trim()); } catch { return null; }
  if (url.protocol !== "https:" || !url.hostname.toLowerCase().endsWith(".blob.vercel-storage.com")) return null;
  if (url.username || url.password) return null;
  let pathname = "";
  try { pathname = decodeURIComponent(url.pathname).replace(/^\/+/, ""); } catch { return null; }

  const prefix = kind === "apk" ? "content/apk/" : "content/images/";
  if (!pathname.startsWith(prefix) || pathname.includes("..") || pathname.includes("\\") || pathname.includes("\0")) return null;

  if (kind === "apk" && !isApkFileName(pathname)) return null;
  if (kind === "image" && !isImageFileName(pathname)) return null;
  return `${url.origin}${url.pathname}`;
}
