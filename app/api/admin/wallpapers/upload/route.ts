import { NextRequest, NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getOptionalUser } from "@/lib/auth";
import {
  WALLPAPER_IMAGE_MIME_TYPES,
  WALLPAPER_MAX_FILE_SIZE,
} from "@/lib/wallpaper-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as HandleUploadBody;

    const response = await handleUpload({
      token: process.env.BLOB_READ_WRITE_TOKEN,
      request,
      body,
      onBeforeGenerateToken: async (pathname) => {
        // Auth is checked here (not at the top of the route) because Vercel
        // calls this same endpoint server-to-server with "blob.upload-completed"
        // and that request has no user session. handleUpload verifies that
        // callback's signature itself.
        const user = await getOptionalUser();
        if (user?.role !== "SUPER_ADMIN") {
          throw new Error("UNAUTHORIZED");
        }

        if (!pathname.startsWith("wallpapers/") || pathname.includes("..")) {
          throw new Error("INVALID_WALLPAPER_UPLOAD_PATH");
        }

        return {
          allowedContentTypes: [...WALLPAPER_IMAGE_MIME_TYPES],
          maximumSizeInBytes: WALLPAPER_MAX_FILE_SIZE,
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => {
        // Database creation happens in /api/admin/wallpapers after the
        // browser receives the Blob URL. This keeps the upload endpoint
        // independent from the database write.
      },
    });

    return NextResponse.json(response);
  } catch (error) {
    console.error("Wallpaper Blob upload handshake failed:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Upload authorization failed",
      },
      { status: error instanceof Error && error.message === "UNAUTHORIZED" ? 401 : 400 },
    );
  }
}
