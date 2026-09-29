-- CreateEnum
CREATE TYPE "PlatformType" AS ENUM (
  'PC',
  'PLAYSTATION',
  'XBOX',
  'NINTENDO',
  'ANDROID',
  'IOS',
  'MAC',
  'LINUX',
  'STEAM_DECK',
  'WEB'
);

-- CreateTable
CREATE TABLE "GamePlatform" (
  "id" TEXT NOT NULL,
  "gameId" TEXT NOT NULL,
  "platform" "PlatformType" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GamePlatform_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GamePlatform_gameId_platform_key"
ON "GamePlatform"("gameId", "platform");

-- CreateIndex
CREATE INDEX "GamePlatform_platform_gameId_idx"
ON "GamePlatform"("platform", "gameId");

-- AddForeignKey
ALTER TABLE "GamePlatform"
ADD CONSTRAINT "GamePlatform_gameId_fkey"
FOREIGN KEY ("gameId")
REFERENCES "Game"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

-- Backfill legacy platform values
INSERT INTO "GamePlatform" ("id", "gameId", "platform")
SELECT
  'gp_' || md5(g."id" || ':' || lower(trim(g."platform"))),
  g."id",
  CASE
    WHEN lower(trim(g."platform")) IN (
      'pc',
      'computer',
      'windows',
      'windows pc'
    )
      THEN 'PC'::"PlatformType"

    WHEN lower(trim(g."platform")) IN (
      'playstation',
      'ps',
      'ps4',
      'ps5',
      'playstation 4',
      'playstation 5'
    )
      THEN 'PLAYSTATION'::"PlatformType"

    WHEN lower(trim(g."platform")) IN (
      'xbox',
      'xbox one',
      'xbox series',
      'xbox series x',
      'xbox series s'
    )
      THEN 'XBOX'::"PlatformType"

    WHEN lower(trim(g."platform")) IN (
      'nintendo',
      'switch',
      'nintendo switch'
    )
      THEN 'NINTENDO'::"PlatformType"

    WHEN lower(trim(g."platform")) = 'android'
      THEN 'ANDROID'::"PlatformType"

    WHEN lower(trim(g."platform")) IN (
      'ios',
      'iphone',
      'ipad'
    )
      THEN 'IOS'::"PlatformType"

    WHEN lower(trim(g."platform")) IN (
      'mac',
      'macos',
      'mac os'
    )
      THEN 'MAC'::"PlatformType"

    WHEN lower(trim(g."platform")) = 'linux'
      THEN 'LINUX'::"PlatformType"

    WHEN lower(trim(g."platform")) IN (
      'steam deck',
      'steamdeck',
      'steam-deck'
    )
      THEN 'STEAM_DECK'::"PlatformType"

    WHEN lower(trim(g."platform")) IN (
      'web',
      'browser'
    )
      THEN 'WEB'::"PlatformType"

    ELSE NULL
  END
FROM "Game" g
WHERE g."platform" IS NOT NULL
  AND trim(g."platform") <> ''
  AND lower(trim(g."platform")) IN (
    'pc',
    'computer',
    'windows',
    'windows pc',
    'playstation',
    'ps',
    'ps4',
    'ps5',
    'playstation 4',
    'playstation 5',
    'xbox',
    'xbox one',
    'xbox series',
    'xbox series x',
    'xbox series s',
    'nintendo',
    'switch',
    'nintendo switch',
    'android',
    'ios',
    'iphone',
    'ipad',
    'mac',
    'macos',
    'mac os',
    'linux',
    'steam deck',
    'steamdeck',
    'steam-deck',
    'web',
    'browser'
  );
