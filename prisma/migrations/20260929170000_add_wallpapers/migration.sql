DO $$ BEGIN
  CREATE TYPE "WallpaperType" AS ENUM ('MOBILE', 'DESKTOP');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "Wallpaper" (
  "id" TEXT NOT NULL,
  "titleAr" TEXT NOT NULL,
  "titleEn" TEXT NOT NULL,
  "descriptionAr" TEXT,
  "descriptionEn" TEXT,
  "imageUrl" TEXT NOT NULL,
  "downloadUrl" TEXT,
  "type" "WallpaperType" NOT NULL,
  "published" BOOLEAN NOT NULL DEFAULT false,
  "featured" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "downloadCount" INTEGER NOT NULL DEFAULT 0,
  "viewCount" INTEGER NOT NULL DEFAULT 0,
  "uploadedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Wallpaper_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Wallpaper_type_published_sortOrder_idx" ON "Wallpaper"("type", "published", "sortOrder");
CREATE INDEX IF NOT EXISTS "Wallpaper_published_featured_idx" ON "Wallpaper"("published", "featured");
CREATE INDEX IF NOT EXISTS "Wallpaper_uploadedById_idx" ON "Wallpaper"("uploadedById");
CREATE INDEX IF NOT EXISTS "Wallpaper_createdAt_idx" ON "Wallpaper"("createdAt");

DO $$ BEGIN
  ALTER TABLE "Wallpaper" ADD CONSTRAINT "Wallpaper_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
