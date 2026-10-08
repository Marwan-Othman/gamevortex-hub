-- Unified content admin: MOD flag + screenshots for games and apps.
ALTER TABLE "Game"
ADD COLUMN "isMod" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "screenshots" TEXT[] DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "App"
ADD COLUMN "isMod" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "screenshots" TEXT[] DEFAULT ARRAY[]::TEXT[];
