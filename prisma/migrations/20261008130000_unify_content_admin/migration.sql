CREATE TYPE "ContentVersionType" AS ENUM ('STANDARD', 'MOD');

ALTER TABLE "Game"
  ADD COLUMN "versionType" "ContentVersionType" NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN "screenshots" JSONB;

ALTER TABLE "App"
  ADD COLUMN "versionType" "ContentVersionType" NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN "screenshots" JSONB;
