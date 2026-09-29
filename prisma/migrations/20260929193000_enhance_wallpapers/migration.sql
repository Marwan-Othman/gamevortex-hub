DO $$ BEGIN ALTER TYPE "SourceStatus" ADD VALUE IF NOT EXISTS 'LICENSED_FOR_DISTRIBUTION'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE "SourceStatus" ADD VALUE IF NOT EXISTS 'OPEN_SOURCE'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TYPE "SourceStatus" ADD VALUE IF NOT EXISTS 'FREEWARE_REDISTRIBUTABLE'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "Wallpaper" ADD COLUMN IF NOT EXISTS "slug" TEXT;
ALTER TABLE "Wallpaper" ADD COLUMN IF NOT EXISTS "thumbnailUrl" TEXT;
ALTER TABLE "Wallpaper" ADD COLUMN IF NOT EXISTS "sourceUrl" TEXT;
ALTER TABLE "Wallpaper" ADD COLUMN IF NOT EXISTS "sourceProvider" TEXT;
ALTER TABLE "Wallpaper" ADD COLUMN IF NOT EXISTS "licenseUrl" TEXT;
ALTER TABLE "Wallpaper" ADD COLUMN IF NOT EXISTS "licenseStatus" TEXT;
ALTER TABLE "Wallpaper" ADD COLUMN IF NOT EXISTS "attribution" TEXT;
ALTER TABLE "Wallpaper" ADD COLUMN IF NOT EXISTS "sourceStatus" "SourceStatus" NOT NULL DEFAULT 'NEEDS_SOURCE';
ALTER TABLE "Wallpaper" ADD COLUMN IF NOT EXISTS "orientation" TEXT NOT NULL DEFAULT 'LANDSCAPE';
ALTER TABLE "Wallpaper" ADD COLUMN IF NOT EXISTS "deviceType" TEXT NOT NULL DEFAULT 'DESKTOP';
ALTER TABLE "Wallpaper" ADD COLUMN IF NOT EXISTS "category" TEXT NOT NULL DEFAULT 'OTHER';
ALTER TABLE "Wallpaper" ADD COLUMN IF NOT EXISTS "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Wallpaper" ADD COLUMN IF NOT EXISTS "width" INTEGER;
ALTER TABLE "Wallpaper" ADD COLUMN IF NOT EXISTS "height" INTEGER;
ALTER TABLE "Wallpaper" ADD COLUMN IF NOT EXISTS "resolution" TEXT;
ALTER TABLE "Wallpaper" ADD COLUMN IF NOT EXISTS "isVip" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Wallpaper"
SET "slug" = CONCAT('wallpaper-', "id")
WHERE "slug" IS NULL OR "slug" = '';

ALTER TABLE "Wallpaper" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "Wallpaper_slug_key" ON "Wallpaper"("slug");
CREATE INDEX IF NOT EXISTS "Wallpaper_published_isVip_createdAt_idx" ON "Wallpaper"("published", "isVip", "createdAt");
CREATE INDEX IF NOT EXISTS "Wallpaper_category_published_idx" ON "Wallpaper"("category", "published");
CREATE INDEX IF NOT EXISTS "Wallpaper_deviceType_orientation_published_idx" ON "Wallpaper"("deviceType", "orientation", "published");

CREATE TABLE IF NOT EXISTS "WallpaperFavorite" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "wallpaperId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WallpaperFavorite_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "WallpaperFavorite_userId_wallpaperId_key" ON "WallpaperFavorite"("userId", "wallpaperId");
CREATE INDEX IF NOT EXISTS "WallpaperFavorite_userId_createdAt_idx" ON "WallpaperFavorite"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "WallpaperFavorite_wallpaperId_createdAt_idx" ON "WallpaperFavorite"("wallpaperId", "createdAt");
DO $$ BEGIN
  ALTER TABLE "WallpaperFavorite" ADD CONSTRAINT "WallpaperFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "WallpaperFavorite" ADD CONSTRAINT "WallpaperFavorite_wallpaperId_fkey" FOREIGN KEY ("wallpaperId") REFERENCES "Wallpaper"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
