-- GameVortex Wallpapers: video media + moderation + reports
CREATE TYPE "WallpaperMediaType" AS ENUM ('IMAGE', 'VIDEO');
CREATE TYPE "WallpaperModerationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

ALTER TABLE "Wallpaper"
  ADD COLUMN "mediaUrl" TEXT,
  ADD COLUMN "mediaType" "WallpaperMediaType" NOT NULL DEFAULT 'IMAGE',
  ADD COLUMN "durationSeconds" INTEGER,
  ADD COLUMN "moderationStatus" "WallpaperModerationStatus" NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN "rejectionReason" TEXT,
  ADD COLUMN "reviewedById" TEXT,
  ADD COLUMN "reviewedAt" TIMESTAMP(3);

CREATE TABLE "WallpaperReport" (
  "id" TEXT NOT NULL,
  "wallpaperId" TEXT NOT NULL,
  "reporterId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "details" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "resolvedById" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WallpaperReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Wallpaper_moderationStatus_published_idx" ON "Wallpaper"("moderationStatus", "published");
CREATE INDEX "Wallpaper_mediaType_published_idx" ON "Wallpaper"("mediaType", "published");
CREATE INDEX "WallpaperReport_wallpaperId_status_createdAt_idx" ON "WallpaperReport"("wallpaperId", "status", "createdAt");
CREATE INDEX "WallpaperReport_reporterId_createdAt_idx" ON "WallpaperReport"("reporterId", "createdAt");

ALTER TABLE "WallpaperReport" ADD CONSTRAINT "WallpaperReport_wallpaperId_fkey"
  FOREIGN KEY ("wallpaperId") REFERENCES "Wallpaper"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WallpaperReport" ADD CONSTRAINT "WallpaperReport_reporterId_fkey"
  FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
