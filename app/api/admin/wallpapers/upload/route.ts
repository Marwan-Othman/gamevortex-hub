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
  const user = await getOptionalUser();
  if (user?.role !== "SUPER_ADMIN") {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  try {
    const body = (await request.json()) as HandleUploadBody;

    const response = await handleUpload({
      token: process.env.BLOB_READ_WRITE_TOKEN,
      request,
      body,
      onBeforeGenerateToken: async (pathname) => {
        const prefix = `wallpapers/${user.id}/`;
        if (!pathname.startsWith(prefix)) {
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
      { status: 400 },
    );
  }
}
