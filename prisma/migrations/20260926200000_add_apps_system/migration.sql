CREATE TABLE "App" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "nameAr" TEXT NOT NULL,
  "nameEn" TEXT NOT NULL,
  "descriptionAr" TEXT,
  "descriptionEn" TEXT,
  "developer" TEXT,
  "publisher" TEXT,
  "iconUrl" TEXT,
  "coverUrl" TEXT,
  "officialUrl" TEXT,
  "downloadSource" TEXT,
  "sourceStatus" "SourceStatus" NOT NULL DEFAULT 'NEEDS_SOURCE',
  "sourceProvider" TEXT,
  "priceCents" INTEGER NOT NULL DEFAULT 0,
  "discountPercent" INTEGER NOT NULL DEFAULT 0,
  "ratingAverage" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "ratingCount" INTEGER NOT NULL DEFAULT 0,
  "viewCount" INTEGER NOT NULL DEFAULT 0,
  "downloadCount" INTEGER NOT NULL DEFAULT 0,
  "published" BOOLEAN NOT NULL DEFAULT false,
  "featured" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "App_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "App_slug_key" ON "App"("slug");
CREATE INDEX "App_published_featured_idx" ON "App"("published", "featured");
CREATE INDEX "App_sourceStatus_idx" ON "App"("sourceStatus");

CREATE TABLE "AppPlatform" (
  "id" TEXT NOT NULL,
  "appId" TEXT NOT NULL,
  "platform" "PlatformType" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppPlatform_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AppPlatform_appId_platform_key" ON "AppPlatform"("appId", "platform");
CREATE INDEX "AppPlatform_platform_appId_idx" ON "AppPlatform"("platform", "appId");
ALTER TABLE "AppPlatform" ADD CONSTRAINT "AppPlatform_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AppCategory" (
  "id" TEXT NOT NULL,
  "appId" TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppCategory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AppCategory_appId_categoryId_key" ON "AppCategory"("appId", "categoryId");
CREATE INDEX "AppCategory_categoryId_appId_idx" ON "AppCategory"("categoryId", "appId");
ALTER TABLE "AppCategory" ADD CONSTRAINT "AppCategory_appId_fkey" FOREIGN KEY ("appId") REFERENCES "App"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AppCategory" ADD CONSTRAINT "AppCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
