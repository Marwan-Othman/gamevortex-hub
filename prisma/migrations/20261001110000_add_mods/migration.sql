CREATE TABLE "Mod" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "titleAr" TEXT NOT NULL,
  "titleEn" TEXT NOT NULL,
  "descriptionAr" TEXT,
  "descriptionEn" TEXT,
  "imageUrl" TEXT,
  "modUrl" TEXT,
  "downloadUrl" TEXT,
  "sourceUrl" TEXT,
  "sourceProvider" TEXT,
  "sourceStatus" "SourceStatus" NOT NULL DEFAULT 'NEEDS_SOURCE',
  "platform" "PlatformType",
  "gameId" TEXT,
  "published" BOOLEAN NOT NULL DEFAULT false,
  "featured" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Mod_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Mod_slug_key" ON "Mod"("slug");
CREATE INDEX "Mod_published_featured_sortOrder_idx" ON "Mod"("published", "featured", "sortOrder");
CREATE INDEX "Mod_gameId_idx" ON "Mod"("gameId");
CREATE INDEX "Mod_platform_published_idx" ON "Mod"("platform", "published");
ALTER TABLE "Mod" ADD CONSTRAINT "Mod_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE SET NULL ON UPDATE CASCADE;
