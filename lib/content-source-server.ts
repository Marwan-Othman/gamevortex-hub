import dns from "node:dns/promises";
import net from "node:net";
import { put } from "@vercel/blob";
import {
  GAME_CONTENT_TYPE_BY_EXTENSION,
  GAME_EXTENSIONS,
  MAX_GAME_FILE_SIZE,
  safeBlobFileName,
  type UploadKind,
} from "@/lib/game-upload-shared";

const MAX_REMOTE_BYTES = Math.min(MAX_GAME_FILE_SIZE, 512 * 1024 * 1024);
const MAX_REDIRECTS = 5;
const ALLOWED_SCHEMES = new Set(["http:", "https:"]);
const ALLOWED_CONTENT_TYPES = new Set([
  "application/octet-stream",
  "application/vnd.android.package-archive",
  "application/zip",
  "application/x-7z-compressed",
  "application/vnd.rar",
  "application/vnd.microsoft.portable-executable",
  "application/x-msdownload",
  "application/x-msi",
  "application/x-apple-diskimage",
  "application/x-newton-compatible-pkg",
  "application/x-iso9660-image",
  "application/x-deb",
  "application/vnd.debian.binary-package",
  "application/gzip",
  "application/x-gzip",
  "application/x-tar",
]);

function isPrivateIp(address: string) {
  const family = net.isIP(address);
  if (family === 4) {
    const [a, b] = address.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127);
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    return normalized === "::1" || normalized === "::" || normalized.startsWith("fc") ||
      normalized.startsWith("fd") || normalized.startsWith("fe80:");
  }
  return true;
}

async function assertSafeUrl(raw: string) {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("INVALID_SOURCE_URL"); }
  if (!ALLOWED_SCHEMES.has(url.protocol)) throw new Error("SOURCE_PROTOCOL_NOT_ALLOWED");
  if (url.username || url.password) throw new Error("SOURCE_CREDENTIALS_NOT_ALLOWED");
  const addresses = await dns.lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error("SOURCE_HOST_NOT_ALLOWED");
  }
  return url;
}

async function fetchRemoteFile(initialUrl: string) {
  let current = await assertSafeUrl(initialUrl);
  for (let attempt = 0; attempt <= MAX_REDIRECTS; attempt += 1) {
    const response = await fetch(current, {
      redirect: "manual",
      headers: { "User-Agent": "GameVortex-ContentImporter/1.0", Accept: "*/*" },
      signal: AbortSignal.timeout(120_000),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || attempt === MAX_REDIRECTS) throw new Error("TOO_MANY_REDIRECTS");
      current = await assertSafeUrl(new URL(location, current).toString());
      continue;
    }
    if (!response.ok || !response.body) throw new Error(`SOURCE_DOWNLOAD_FAILED_${response.status}`);
    return { response, finalUrl: current.toString() };
  }
  throw new Error("SOURCE_DOWNLOAD_FAILED");
}

function extensionOf(name: string) {
  const lower = name.toLowerCase();
  return GAME_EXTENSIONS.find((extension) => lower.endsWith(extension)) ?? "";
}

function filenameFromUrl(url: string) {
  try {
    const parsed = new URL(url);
    const raw = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || "gamevortex-file");
    return raw.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 180) || "gamevortex-file";
  } catch {
    return "gamevortex-file";
  }
}

export async function importRemoteContentFile(sourceUrl: string, kind: "game" | "app") {
  const { response, finalUrl } = await fetchRemoteFile(sourceUrl);
  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (declaredSize > MAX_REMOTE_BYTES) throw new Error("SOURCE_FILE_TOO_LARGE");

  const contentType = (response.headers.get("content-type") || "application/octet-stream")
    .split(";", 1)[0].trim().toLowerCase();
  const filename = filenameFromUrl(finalUrl);
  const extension = extensionOf(filename);
  if (!extension && !ALLOWED_CONTENT_TYPES.has(contentType)) throw new Error("FILE_TYPE_NOT_ALLOWED");

  let bytesSeen = 0;
  const limitedStream = response.body!.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytesSeen += chunk.byteLength;
      if (bytesSeen > MAX_REMOTE_BYTES) {
        controller.error(new Error("SOURCE_FILE_TOO_LARGE"));
        return;
      }
      controller.enqueue(chunk);
    },
  }));

  const safeName = safeBlobFileName(filename);
  const folder = kind === "app" ? "apps/files/" : "games/files/";
  const blob = await put(`${folder}${Date.now()}-${crypto.randomUUID()}/${safeName}`, limitedStream, {
    access: "public",
    addRandomSuffix: false,
    contentType: extension ? (GAME_CONTENT_TYPE_BY_EXTENSION[extension] || contentType) : contentType,
  });

  return {
    url: blob.url,
    finalUrl,
    filename: safeName,
    contentType,
    sizeBytes: bytesSeen || declaredSize || 0,
  };
}
