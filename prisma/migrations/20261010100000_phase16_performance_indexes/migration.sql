-- Phase 16 (Performance): composite indexes for hot public read paths.
-- Additive only: no data is changed and no constraints are added.
-- IF NOT EXISTS makes the migration safe to re-run on a partially applied database.

-- Game: home rails + /games sorts all filter on published and order by these columns.
CREATE INDEX IF NOT EXISTS "Game_published_createdAt_idx"
  ON "Game"("published", "createdAt");
CREATE INDEX IF NOT EXISTS "Game_published_ratingAverage_ratingCount_idx"
  ON "Game"("published", "ratingAverage", "ratingCount");
CREATE INDEX IF NOT EXISTS "Game_published_playCount_viewCount_idx"
  ON "Game"("published", "playCount", "viewCount");
CREATE INDEX IF NOT EXISTS "Game_published_viewCount_idx"
  ON "Game"("published", "viewCount");

-- App: home "apps" rail and /apps list.
CREATE INDEX IF NOT EXISTS "App_published_createdAt_idx"
  ON "App"("published", "createdAt");

-- GameProduct: /marketplace orders active products by newest.
CREATE INDEX IF NOT EXISTS "GameProduct_active_createdAt_idx"
  ON "GameProduct"("active", "createdAt");

-- GameLibraryItem: profile + library list "recently updated" without a status filter.
CREATE INDEX IF NOT EXISTS "GameLibraryItem_userId_updatedAt_idx"
  ON "GameLibraryItem"("userId", "updatedAt");

-- GamerProfile: /rankings orders by level desc, xp desc.
CREATE INDEX IF NOT EXISTS "GamerProfile_level_xp_idx"
  ON "GamerProfile"("level", "xp");
