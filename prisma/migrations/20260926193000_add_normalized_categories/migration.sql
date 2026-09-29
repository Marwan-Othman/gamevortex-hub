CREATE TABLE IF NOT EXISTS "Category" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "nameAr" TEXT NOT NULL,
  "nameEn" TEXT NOT NULL,
  "descriptionAr" TEXT,
  "descriptionEn" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Category_slug_key" ON "Category"("slug");
CREATE INDEX IF NOT EXISTS "Category_active_sortOrder_idx" ON "Category"("active", "sortOrder");

CREATE TABLE IF NOT EXISTS "GameCategory" (
  "id" TEXT NOT NULL,
  "gameId" TEXT NOT NULL,
  "categoryId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GameCategory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "GameCategory_gameId_categoryId_key" ON "GameCategory"("gameId", "categoryId");
CREATE INDEX IF NOT EXISTS "GameCategory_categoryId_gameId_idx" ON "GameCategory"("categoryId", "gameId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'GameCategory_gameId_fkey'
  ) THEN
    ALTER TABLE "GameCategory"
      ADD CONSTRAINT "GameCategory_gameId_fkey"
      FOREIGN KEY ("gameId") REFERENCES "Game"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'GameCategory_categoryId_fkey'
  ) THEN
    ALTER TABLE "GameCategory"
      ADD CONSTRAINT "GameCategory_categoryId_fkey"
      FOREIGN KEY ("categoryId") REFERENCES "Category"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Backfill the normalized category relation from the legacy Game.genre field.
-- Legacy values are preserved; this only creates a parallel normalized source.
INSERT INTO "Category" (
  "id",
  "slug",
  "nameAr",
  "nameEn",
  "active",
  "sortOrder",
  "createdAt",
  "updatedAt"
)
SELECT
  'cat_legacy_' || substr(md5(lower(trim(g."genre"))), 1, 20),
  'legacy-' || substr(md5(lower(trim(g."genre"))), 1, 20),
  trim(g."genre"),
  trim(g."genre"),
  true,
  0,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Game" g
WHERE g."genre" IS NOT NULL
  AND trim(g."genre") <> ''
GROUP BY lower(trim(g."genre")), trim(g."genre")
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "GameCategory" (
  "id",
  "gameId",
  "categoryId",
  "createdAt"
)
SELECT
  'gcat_' || substr(md5(g."id" || ':' || lower(trim(g."genre"))), 1, 24),
  g."id",
  c."id",
  CURRENT_TIMESTAMP
FROM "Game" g
JOIN "Category" c
  ON c."slug" = 'legacy-' || substr(md5(lower(trim(g."genre"))), 1, 20)
WHERE g."genre" IS NOT NULL
  AND trim(g."genre") <> ''
ON CONFLICT ("gameId", "categoryId") DO NOTHING;
