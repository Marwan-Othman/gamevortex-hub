-- Add gallery storage without changing existing content rows.
ALTER TABLE "Game" ADD COLUMN "galleryUrls" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "App" ADD COLUMN "galleryUrls" JSONB NOT NULL DEFAULT '[]';
