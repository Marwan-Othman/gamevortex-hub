import dns from "node:dns/promises";
import net from "node:net";
import { put } from "@vercel/blob";
import { MAX_CONTENT_REMOTE_APK_SIZE, isApkFileName, safeContentFileName } from "@/lib/content-upload-shared";

const MAX_REDIRECTS = 5;
const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

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
    if (normalized.startsWith("::ffff:")) return isPrivateIp(normalized.slice(7));
    return normalized === "::1" || normalized === "::" || normalized.startsWith("fc") ||
      normalized.startsWith("fd") || normalized.startsWith("fe80:");
  }
  return true;
}

async function assertSafeRemoteUrl(raw: string) {
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

function filenameFromResponse(url: URL, contentDisposition: string) {
  const disposition = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(contentDisposition);
  const candidate = disposition?.[1] ? decodeURIComponent(disposition[1]) : decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || "");
  return safeContentFileName(candidate, "application.apk");
}

export async function importRemoteApk(sourceUrl: string) {
  let current = await assertSafeRemoteUrl(sourceUrl);

  for (let attempt = 0; attempt <= MAX_REDIRECTS; attempt += 1) {
    const response = await fetch(current, {
      redirect: "manual",
      headers: { "User-Agent": "GameVortex-Content-Importer/1.0", Accept: "application/vnd.android.package-archive,application/octet-stream,*/*" },
      signal: AbortSignal.timeout(120_000),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || attempt === MAX_REDIRECTS) throw new Error("TOO_MANY_REDIRECTS");
      current = await assertSafeRemoteUrl(new URL(location, current).toString());
      continue;
    }

    if (!response.ok || !response.body) throw new Error(`SOURCE_DOWNLOAD_FAILED_${response.status}`);

    const contentType = (response.headers.get("content-type") || "application/octet-stream").split(";", 1)[0].trim().toLowerCase();
    const filename = filenameFromResponse(current, response.headers.get("content-disposition") || "");
    const declaredSize = Number(response.headers.get("content-length") || 0);

    if (!isApkFileName(filename) && contentType !== "application/vnd.android.package-archive") {
      throw new Error("SOURCE_IS_NOT_APK");
    }
    if (declaredSize > MAX_CONTENT_REMOTE_APK_SIZE) throw new Error("SOURCE_FILE_TOO_LARGE");

    let bytesSeen = 0;
    const limitedStream = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytesSeen += chunk.byteLength;
        if (bytesSeen > MAX_CONTENT_REMOTE_APK_SIZE) {
          controller.error(new Error("SOURCE_FILE_TOO_LARGE"));
          return;
        }
        controller.enqueue(chunk);
      },
    }));

    const blob = await put(
      `content/apk/${Date.now()}-${crypto.randomUUID()}/${filename.endsWith(".apk") ? filename : "application.apk"}`,
      limitedStream,
      {
        access: "public",
        addRandomSuffix: false,
        contentType: "application/vnd.android.package-archive",
        cacheControlMaxAge: 2592000,
      },
    );

    return {
      url: blob.url,
      finalUrl: current.toString(),
      filename,
      sizeBytes: bytesSeen || declaredSize || 0,
    };
  }

  throw new Error("SOURCE_DOWNLOAD_FAILED");
}
