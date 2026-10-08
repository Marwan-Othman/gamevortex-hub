import { NextRequest, NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getOptionalUser } from "@/lib/auth";
import { guardMutation } from "@/lib/api";
import { deleteUnreferencedBlobs } from "@/lib/game-upload-server";
import {
  APK_CONTENT_TYPES,
  CONTENT_IMAGE_TYPES,
  MAX_CONTENT_APK_SIZE,
  MAX_CONTENT_IMAGE_SIZE,
  buildContentBlobPath,
  canonicalContentBlobUrl,
  isApkFileName,
  isImageFileName,
  type ContentUploadKind,
} from "@/lib/content-upload-shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireSuperAdmin() {
  const user = await getOptionalUser();
  if (!user) return { error: NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }) } as const;
  if (user.role !== "SUPER_ADMIN") return { error: NextResponse.json({ success: false, error: "Forbidden" }, { status: 403 }) } as const;
  return { user } as const;
}

function parseKind(value: unknown): ContentUploadKind | null {
  return value === "apk" || value === "image" ? value : null;
}

export async function POST(request: NextRequest) {
  const blocked = await guardMutation(request, "admin-content-upload", 120);
  if (blocked) return blocked;
  const auth = await requireSuperAdmin();
  if ("error" in auth) return auth.error;

  try {
    const body = (await request.json()) as HandleUploadBody;
    const response = await handleUpload({
      ...(process.env.BLOB_READ_WRITE_TOKEN?.trim() ? { token: process.env.BLOB_READ_WRITE_TOKEN.trim() } : {}),
      request,
      body,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const current = await getOptionalUser();
        if (!current) throw new Error("UNAUTHORIZED");
        if (current.role !== "SUPER_ADMIN") throw new Error("FORBIDDEN");

        let payload: { kind?: unknown; size?: unknown; mimeType?: unknown };
        try {
          payload = JSON.parse(clientPayload || "{}");
        } catch {
          throw new Error("INVALID_CLIENT_PAYLOAD");
        }

        const kind = parseKind(payload.kind);
        if (!kind) throw new Error("INVALID_UPLOAD_KIND");

        const size = Number(payload.size);
        const mimeType = typeof payload.mimeType === "string" ? payload.mimeType.toLowerCase() : "";
        const normalizedPath = pathname.trim().replace(/^\/+/, "");

        if (!Number.isFinite(size) || size <= 0) throw new Error("INVALID_UPLOAD_SIZE");

        if (kind === "apk") {
          if (!normalizedPath.startsWith("content/apk/") || !isApkFileName(normalizedPath)) throw new Error("INVALID_UPLOAD_PATH");
          if (size > MAX_CONTENT_APK_SIZE) throw new Error("APK_FILE_TOO_LARGE");
          if (!(APK_CONTENT_TYPES as readonly string[]).includes(mimeType) && mimeType !== "") throw new Error("APK_TYPE_NOT_SUPPORTED");
          return { allowedContentTypes: [...APK_CONTENT_TYPES], maximumSizeInBytes: MAX_CONTENT_APK_SIZE, addRandomSuffix: false };
        }

        if (!normalizedPath.startsWith("content/images/") || !isImageFileName(normalizedPath)) throw new Error("INVALID_UPLOAD_PATH");
        if (size > MAX_CONTENT_IMAGE_SIZE) throw new Error("IMAGE_FILE_TOO_LARGE");
        if (!(CONTENT_IMAGE_TYPES as readonly string[]).includes(mimeType)) throw new Error("IMAGE_TYPE_NOT_SUPPORTED");
        return { allowedContentTypes: [...CONTENT_IMAGE_TYPES], maximumSizeInBytes: MAX_CONTENT_IMAGE_SIZE, addRandomSuffix: false };
      },
    });
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "UPLOAD_FAILED";
    const status = ["UNAUTHORIZED", "FORBIDDEN"].includes(message) ? (message === "UNAUTHORIZED" ? 401 : 403) : 400;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

export async function DELETE(request: NextRequest) {
  const blocked = await guardMutation(request, "admin-content-upload-cleanup", 30);
  if (blocked) return blocked;
  const auth = await requireSuperAdmin();
  if ("error" in auth) return auth.error;

  try {
    const body = await request.json();
    const urls = Array.isArray(body?.urls) ? body.urls.filter((x: unknown): x is string => typeof x === "string" && x.trim()) : [];
    if (urls.length > 100) return NextResponse.json({ success: false, error: "TOO_MANY_URLS" }, { status: 400 });
    if (urls.some((url) => !canonicalContentBlobUrl(url, "apk") && !canonicalContentBlobUrl(url, "image"))) {
      return NextResponse.json({ success: false, error: "INVALID_CLEANUP_URL" }, { status: 400 });
    }
    const result = await deleteUnreferencedBlobs(urls);
    return NextResponse.json({ success: true, ...result });
  } catch {
    return NextResponse.json({ success: false, error: "CLEANUP_FAILED" }, { status: 500 });
  }
}

export function contentUploadPath(kind: ContentUploadKind, filename: string) {
  return buildContentBlobPath(kind, filename);
}
