-- GameVortex Wallpapers: preserve original uploaded file metadata.
ALTER TABLE "Wallpaper" ADD COLUMN IF NOT EXISTS "originalFilename" TEXT;
ALTER TABLE "Wallpaper" ADD COLUMN IF NOT EXISTS "mimeType" TEXT;
ALTER TABLE "Wallpaper" ADD COLUMN IF NOT EXISTS "fileSizeBytes" BIGINT;
ALTER TABLE "Wallpaper" ADD COLUMN IF NOT EXISTS "isAnimated" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "Wallpaper_isAnimated_published_idx"
  ON "Wallpaper"("isAnimated", "published");
