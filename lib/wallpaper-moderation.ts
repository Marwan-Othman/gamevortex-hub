import { WallpaperMediaType, WallpaperModerationStatus } from "@prisma/client";
import { isHttpsUrl } from "@/lib/wallpapers";

const VIDEO_MAX_SECONDS = 120;

export function validateWallpaperMedia(input: {
  mediaType: WallpaperMediaType;
  imageUrl: string;
  mediaUrl?: string | null;
  durationSeconds?: number | null;
}) {
  if (!isHttpsUrl(input.imageUrl)) throw new Error("IMAGE_URL_MUST_BE_HTTPS");

  if (input.mediaType === WallpaperMediaType.VIDEO) {
    if (!input.mediaUrl || !isHttpsUrl(input.mediaUrl)) {
      throw new Error("VIDEO_URL_MUST_BE_HTTPS");
    }
    if (!Number.isInteger(input.durationSeconds) || input.durationSeconds! < 1 || input.durationSeconds! > VIDEO_MAX_SECONDS) {
      throw new Error("VIDEO_DURATION_INVALID");
    }
  }

  if (input.mediaType === WallpaperMediaType.IMAGE && input.durationSeconds != null) {
    throw new Error("IMAGE_CANNOT_HAVE_VIDEO_DURATION");
  }
}

export function normalizeModerationStatus(value: unknown): WallpaperModerationStatus {
  if (value === "APPROVED") return WallpaperModerationStatus.APPROVED;
  if (value === "REJECTED") return WallpaperModerationStatus.REJECTED;
  return WallpaperModerationStatus.PENDING;
}

export function canPublishModeratedWallpaper(status: WallpaperModerationStatus) {
  return status === WallpaperModerationStatus.APPROVED;
}
