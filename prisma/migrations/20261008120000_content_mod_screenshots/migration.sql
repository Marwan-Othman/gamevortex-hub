-- Unified content admin: MOD flag + screenshots for games and apps.
-- Idempotent: safe if some columns already exist in the database.
ALTER TABLE "Game"
ADD COLUMN IF NOT EXISTS "isMod" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "screenshots" TEXT[] DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "App"
ADD COLUMN IF NOT EXISTS "isMod" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "screenshots" TEXT[] DEFAULT ARRAY[]::TEXT[];
