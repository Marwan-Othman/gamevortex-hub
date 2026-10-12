-- GameVortex Wallpaper Studio: saved designs (additive only, no existing data is touched).

-- CreateTable
CREATE TABLE "WallpaperDesign" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "backgroundKind" TEXT NOT NULL DEFAULT 'none',
    "backgroundWallpaperId" TEXT,
    "tier" TEXT NOT NULL DEFAULT 'FREE',
    "document" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WallpaperDesign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WallpaperDesign_userId_updatedAt_idx" ON "WallpaperDesign"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "WallpaperDesign_backgroundWallpaperId_idx" ON "WallpaperDesign"("backgroundWallpaperId");

-- AddForeignKey
ALTER TABLE "WallpaperDesign" ADD CONSTRAINT "WallpaperDesign_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WallpaperDesign" ADD CONSTRAINT "WallpaperDesign_backgroundWallpaperId_fkey" FOREIGN KEY ("backgroundWallpaperId") REFERENCES "Wallpaper"("id") ON DELETE SET NULL ON UPDATE CASCADE;
