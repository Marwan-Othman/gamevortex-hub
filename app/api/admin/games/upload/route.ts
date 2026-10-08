import { NextRequest, NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getOptionalUser } from "@/lib/auth";
import { guardMutation } from "@/lib/api";
import {
  COVER_CONTENT_TYPES,
  GAME_BLOB_CONTENT_TYPE,
  MAX_COVER_FILE_SIZE,
  MAX_GAME_FILE_SIZE,
  isValidBlobPathname,
  type UploadKind,
} from "@/lib/game-upload-shared";
import { canonicalAnyBlobUrl, deleteUnreferencedBlobs } from "@/lib/game-upload-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Game/Mod files are pinned to application/octet-stream by the client, but we also accept the
 * MIME types mobile browsers commonly report, so a browser quirk never blocks a valid upload.
 * The real gate is the pathname extension, enforced in onBeforeGenerateToken.
 */
const GAME_CONTENT_TYPES = [
  GAME_BLOB_CONTENT_TYPE,
  "application/zip",
  "application/x-zip-compressed",
  "application/x-7z-compressed",
  "application/x-rar-compressed",
  "application/vnd.rar",
  "application/vnd.android.package-archive",
  "application/vnd.microsoft.portable-executable",
  "application/x-msdownload",
  "application/x-dosexec",
  "application/x-msi",
  "application/x-apple-diskimage",
  "application/x-newton-compatible-pkg",
  "application/x-iso9660-image",
  "application/x-deb",
  "application/vnd.debian.binary-package",
  "application/gzip",
  "application/x-gzip",
  "application/x-tar",
];

const CLIENT_ERRORS = new Set([
  "INVALID_UPLOAD_KIND",
  "INVALID_UPLOAD_PATH",
  "INVALID_UPLOAD_SIZE",
  "GAME_FILE_TOO_LARGE",
  "MOD_FILE_TOO_LARGE",
  "COVER_FILE_TOO_LARGE",
  "COVER_TYPE_NOT_SUPPORTED",
  "INVALID_CLIENT_PAYLOAD",
]);

type ClientPayload = { kind?: unknown; mimeType?: unknown; size?: unknown };

function parseKind(value: unknown): UploadKind | null {
  return value === "game" || value === "mod" || value === "cover" ? value : null;
}

function parseClientPayload(raw: string | null): ClientPayload {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as ClientPayload;
  } catch {
    // fall through
  }
  throw new Error("INVALID_CLIENT_PAYLOAD");
}

async function requireSuperAdmin() {
  const user = await getOptionalUser();
  if (!user) return { error: NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }) } as const;
  if (user.role !== "SUPER_ADMIN") {
    return { error: NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 }) } as const;
  }
  return { user } as const;
}

/**
 * Cleanup of orphaned uploads. Only GameVortex upload URLs are accepted, and files already
 * referenced by an existing Game or Mod are never deleted.
 */
export async function DELETE(request: NextRequest) {
  const guard = await guardMutation(request, "admin-game-upload-cleanup", 30);
  if (guard) return guard;

  const auth = await requireSuperAdmin();
  if ("error" in auth) return auth.error;

  try {
    const body: unknown = await request.json();
    const rawUrls =
      body && typeof body === "object" && "urls" in body && Array.isArray((body as { urls: unknown }).urls)
        ? (body as { urls: unknown[] }).urls
        : [];
    const urls = rawUrls.filter((value): value is string => typeof value === "string" && value.trim().length > 0);

    if (urls.length > 300) return NextResponse.json({ success: false, error: "Too many cleanup URLs" }, { status: 400 });
    if (urls.some((value) => canonicalAnyBlobUrl(value) === null)) {
      return NextResponse.json({ success: false, error: "Invalid cleanup URL" }, { status: 400 });
    }

    const result = await deleteUnreferencedBlobs(urls);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("DELETE /api/admin/games/upload cleanup error:", error instanceof Error ? error.message : "UNKNOWN");
    return NextResponse.json({ success: false, error: "CLEANUP_FAILED" }, { status: 500 });
  }
}

/** Issues short-lived client-upload tokens. The file itself never passes through this server. */
export async function POST(request: NextRequest) {
  const guard = await guardMutation(request, "admin-game-upload", 120);
  if (guard) return guard;

  const auth = await requireSuperAdmin();
  if ("error" in auth) return auth.error;

  try {
    const body = (await request.json()) as HandleUploadBody;
    const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();

    const response = await handleUpload({
      ...(token ? { token } : {}),
      request,
      body,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        // Re-check on the token request itself; never rely on the outer check alone.
        const current = await getOptionalUser();
        if (!current) throw new Error("UNAUTHORIZED");
        if (current.role !== "SUPER_ADMIN") throw new Error("FORBIDDEN");

        const payload = parseClientPayload(clientPayload);
        const kind = parseKind(payload.kind);
        if (!kind) throw new Error("INVALID_UPLOAD_KIND");
        if (!isValidBlobPathname(pathname, kind)) throw new Error("INVALID_UPLOAD_PATH");

        const size = Number(payload.size ?? 0);
        if (!Number.isFinite(size) || size <= 0) throw new Error("INVALID_UPLOAD_SIZE");

        if (kind === "cover") {
          if (size > MAX_COVER_FILE_SIZE) throw new Error("COVER_FILE_TOO_LARGE");
          const mimeType = typeof payload.mimeType === "string" ? payload.mimeType.toLowerCase() : "";
          if (!(COVER_CONTENT_TYPES as readonly string[]).includes(mimeType)) throw new Error("COVER_TYPE_NOT_SUPPORTED");
          return {
            allowedContentTypes: [...COVER_CONTENT_TYPES],
            maximumSizeInBytes: MAX_COVER_FILE_SIZE,
            addRandomSuffix: true,
          };
        }

        if (size > MAX_GAME_FILE_SIZE) throw new Error(kind === "mod" ? "MOD_FILE_TOO_LARGE" : "GAME_FILE_TOO_LARGE");
        return {
          allowedContentTypes: GAME_CONTENT_TYPES,
          maximumSizeInBytes: MAX_GAME_FILE_SIZE,
          addRandomSuffix: true,
        };
      },
    });

    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "UPLOAD_FAILED";
    const status = CLIENT_ERRORS.has(message) ? 400 : message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;

    console.error("POST /api/admin/games/upload error:", message);
    return NextResponse.json({ success: false, error: "GAME_UPLOAD_FAILED", detail: message }, { status });
  }
}
