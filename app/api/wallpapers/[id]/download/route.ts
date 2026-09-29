import { NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { db } from "../../../../../lib/prisma";
import { getOptionalUser } from "../../../../../lib/auth";
import { getVipAccess } from "../../../../../lib/vip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeDownloadName(value: string | null | undefined, fallback: string) {
  const name = (value || fallback)
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 150);
  return name || fallback;
}

function filenameWithExtension(filename: string, mimeType: string | null | undefined) {
  if (/\.[a-z0-9]{2,8}$/i.test(filename)) return filename;
  const extensions: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/apng": ".apng",
    "image/avif": ".avif",
    "image/svg+xml": ".svg",
  };
  return `${filename}${extensions[mimeType || ""] || ""}`;
}

function localPublicFilePath(url: string) {
  if (!url.startsWith("/wallpapers/") || url.includes("..")) return null;
  const relative = url.replace(/^\/+/, "");
  const publicRoot = path.resolve(process.cwd(), "public");
  const filePath = path.resolve(publicRoot, relative);
  if (!filePath.startsWith(`${publicRoot}${path.sep}`)) return null;
  return filePath;
}

function contentTypeFromPath(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  const types: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".apng": "image/apng",
    ".avif": "image/avif",
    ".svg": "image/svg+xml",
  };
  return types[ext] || "application/octet-stream";
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!id || id.length > 100) {
      return NextResponse.json({ error: "Invalid wallpaper id" }, { status: 400 });
    }

    const wallpaper = await db.wallpaper.findUnique({
      where: { id },
      select: {
        id: true,
        imageUrl: true,
        downloadUrl: true,
        mediaUrl: true,
        mediaType: true,
        published: true,
        isVip: true,
        moderationStatus: true,
        originalFilename: true,
        mimeType: true,
      },
    });

    if (!wallpaper || !wallpaper.published || wallpaper.moderationStatus !== "APPROVED") {
      return NextResponse.json({ error: "Wallpaper not found" }, { status: 404 });
    }

    if (wallpaper.isVip) {
      const user = await getOptionalUser();
      if (!user) return NextResponse.json({ error: "VIP_LOGIN_REQUIRED" }, { status: 401 });

      const access = await getVipAccess(user.id);
      if (!access.isVip) return NextResponse.json({ error: "VIP_REQUIRED" }, { status: 403 });
    }

    const targetUrl = wallpaper.downloadUrl || wallpaper.mediaUrl || wallpaper.imageUrl;
    const baseName = safeDownloadName(
      wallpaper.originalFilename,
      `gamevortex-wallpaper-${wallpaper.id}`,
    );

    // GameVortex-generated wallpapers live inside /public.
    // They are served directly from this route, so the browser never leaves GameVortex.
    const localPath = localPublicFilePath(targetUrl);

    if (localPath) {
      const contentType = wallpaper.mimeType || contentTypeFromPath(localPath);
      const filename = filenameWithExtension(baseName, contentType);

      // Read from disk when possible. On Vercel, files in /public are served by
      // the CDN and are NOT part of the function bundle, so fall back to fetching
      // the same file from this site's own origin.
      let file: Buffer | null = null;
      const fileInfo = await stat(localPath).catch(() => null);
      if (fileInfo?.isFile()) {
        file = await readFile(localPath).catch(() => null);
      }
      if (!file) {
        const origin = process.env.APP_ORIGIN || new URL(request.url).origin;
        const selfResponse = await fetch(new URL(targetUrl, origin), {
          cache: "no-store",
          signal: AbortSignal.timeout(30_000),
        }).catch(() => null);
        if (selfResponse?.ok) file = Buffer.from(await selfResponse.arrayBuffer());
      }
      if (!file) {
        return NextResponse.json({ error: "Wallpaper file is currently unavailable" }, { status: 404 });
      }

      await db.wallpaper.update({
        where: { id: wallpaper.id },
        data: { downloadCount: { increment: 1 } },
      });

      const headers = new Headers();
      headers.set("Content-Type", contentType);
      headers.set(
        "Content-Disposition",
        `attachment; filename="${filename.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      );
      headers.set("Cache-Control", "private, no-store, max-age=0");
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("Content-Length", String(file.byteLength));

      return new Response(file, { status: 200, headers });
    }

    // Uploaded/imported wallpapers are stored in GameVortex Blob storage.
    // The server proxies the bytes, so the user still downloads from GameVortex.
    const upstream = await fetch(targetUrl, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
      headers: { "user-agent": "GameVortex-Wallpaper-Downloader/1.0" },
    });

    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: "Wallpaper file is currently unavailable" }, { status: 502 });
    }

    const contentType =
      wallpaper.mimeType ||
      upstream.headers.get("content-type") ||
      "application/octet-stream";

    const filename = filenameWithExtension(baseName, contentType);

    await db.wallpaper.update({
      where: { id: wallpaper.id },
      data: { downloadCount: { increment: 1 } },
    });

    const headers = new Headers();
    headers.set("Content-Type", contentType);
    headers.set(
      "Content-Disposition",
      `attachment; filename="${filename.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    headers.set("Cache-Control", "private, no-store, max-age=0");
    headers.set("X-Content-Type-Options", "nosniff");

    const contentLength = upstream.headers.get("content-length");
    if (contentLength) headers.set("Content-Length", contentLength);

    return new Response(upstream.body, { status: 200, headers });
  } catch (error) {
    console.error("Wallpaper download error:", error);
    return NextResponse.json({ error: "Failed to process wallpaper download" }, { status: 500 });
  }
}
