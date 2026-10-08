import { NextRequest, NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getOptionalUser } from "@/lib/auth";
import { guardMutation } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_GAME_FILE_SIZE = 50 * 1024 * 1024 * 1024;
const MAX_COVER_FILE_SIZE = 15 * 1024 * 1024;

const COVER_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];
const GAME_TYPES = [
  "application/octet-stream",
  "application/zip",
  "application/x-zip-compressed",
  "application/x-7z-compressed",
  "application/x-rar-compressed",
  "application/vnd.android.package-archive",
  "application/vnd.microsoft.portable-executable",
  "application/x-msdownload",
  "application/x-apple-diskimage",
  "application/x-iso9660-image",
  "application/x-deb",
  "application/gzip",
  "application/x-gzip",
  "application/x-tar",
];

const GAME_EXTENSIONS = [
  ".apk",".aab",".exe",".msi",".zip",".7z",".rar",".iso",".img",".dmg",
  ".pkg",".appimage",".deb",".tar",".gz",".tgz",".tar.gz",
];

function hasAllowedGameExtension(pathname: string) {
  const lower = pathname.toLowerCase();
  return GAME_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

function isVercelBlobUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.endsWith(".blob.vercel-storage.com");
  } catch {
    return false;
  }
}

function validPathname(pathname: unknown, kind: "game" | "cover") {
  if (typeof pathname !== "string" || !pathname.trim()) return false;
  const value = pathname.trim();
  if (value.includes("..") || value.includes("\\") || value.includes("\0")) return false;
  if (kind === "game") return value.startsWith("games/files/") && hasAllowedGameExtension(value);
  return value.startsWith("games/covers/");
}

export async function DELETE(request: NextRequest) {
  const guard = await guardMutation(request, "admin-game-upload-cleanup", 30);
  if (guard) return guard;

  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (user.role !== "SUPER_ADMIN") return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });

  try {
    const body = await request.json();
    const urls = Array.isArray(body?.urls)
      ? body.urls.filter((value: unknown): value is string => typeof value === "string" && value.trim())
      : [];

    if (urls.length > 2) {
      return NextResponse.json({ success: false, error: "Too many cleanup URLs" }, { status: 400 });
    }

    const safeUrls = urls.filter((value) => isVercelBlobUrl(value));
    if (safeUrls.length !== urls.length) {
      return NextResponse.json({ success: false, error: "Invalid cleanup URL" }, { status: 400 });
    }

    if (safeUrls.length) {
      await del(safeUrls);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("DELETE /api/admin/games/upload cleanup error:", error instanceof Error ? error.message : "UNKNOWN");
    return NextResponse.json({ success: false, error: "CLEANUP_FAILED" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const guard = await guardMutation(request, "admin-game-upload", 30);
  if (guard) return guard;

  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  if (user.role !== "SUPER_ADMIN") return NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 });

  try {
    const body = (await request.json()) as HandleUploadBody;
    const response = await handleUpload({
      ...(process.env.BLOB_READ_WRITE_TOKEN?.trim()
        ? { token: process.env.BLOB_READ_WRITE_TOKEN.trim() }
        : {}),
      request,
      body,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const payload = clientPayload
          ? (JSON.parse(clientPayload) as { kind?: string; mimeType?: string; size?: number })
          : {};
        const user = await getOptionalUser();
        if (!user) throw new Error("UNAUTHORIZED");
        if (user.role !== "SUPER_ADMIN") throw new Error("FORBIDDEN");

        const kind = payload.kind === "cover" ? "cover" : payload.kind === "game" ? "game" : null;
        if (!kind) throw new Error("INVALID_UPLOAD_KIND");
        if (!validPathname(pathname, kind)) throw new Error("INVALID_UPLOAD_PATH");

        const size = Number(payload.size || 0);
        if (!Number.isFinite(size) || size <= 0) throw new Error("INVALID_UPLOAD_SIZE");
        if (kind === "game" && size > MAX_GAME_FILE_SIZE) throw new Error("GAME_FILE_TOO_LARGE");
        if (kind === "cover" && size > MAX_COVER_FILE_SIZE) throw new Error("COVER_FILE_TOO_LARGE");

        const mimeType = typeof payload.mimeType === "string" ? payload.mimeType.toLowerCase() : "";
        if (kind === "cover" && !COVER_TYPES.includes(mimeType)) throw new Error("COVER_TYPE_NOT_SUPPORTED");
        if (kind === "game" && !GAME_TYPES.includes(mimeType) && mimeType !== "") throw new Error("GAME_TYPE_NOT_SUPPORTED");

        return {
          allowedContentTypes: kind === "cover" ? COVER_TYPES : GAME_TYPES,
          maximumSizeInBytes: kind === "cover" ? MAX_COVER_FILE_SIZE : MAX_GAME_FILE_SIZE,
          addRandomSuffix: true,
        };
      },
    });

    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "UPLOAD_FAILED";
    const status = [
      "INVALID_UPLOAD_KIND","INVALID_UPLOAD_PATH","INVALID_UPLOAD_SIZE",
      "GAME_FILE_TOO_LARGE","COVER_FILE_TOO_LARGE",
      "COVER_TYPE_NOT_SUPPORTED","GAME_TYPE_NOT_SUPPORTED",
    ].includes(message) ? 400
      : message === "UNAUTHORIZED" ? 401
      : message === "FORBIDDEN" ? 403
      : 500;

    console.error("POST /api/admin/games/upload error:", message);
    return NextResponse.json({ success: false, error: "GAME_UPLOAD_FAILED", detail: message }, { status });
  }
}
