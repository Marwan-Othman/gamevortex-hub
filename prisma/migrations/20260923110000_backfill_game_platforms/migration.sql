-- Backfill GamePlatform for legacy comma-separated Game.platform values.
-- Uses case-insensitive token matching and ignores unknown labels.
INSERT INTO "GamePlatform" ("id", "gameId", "platform")
SELECT DISTINCT
  'gp_' || md5(g."id" || ':' || p.platform::text),
  g."id",
  p.platform
FROM "Game" g
CROSS JOIN LATERAL (
  SELECT CASE
    WHEN lower(trim(token)) IN ('pc','computer','windows','windows pc') THEN 'PC'::"PlatformType"
    WHEN lower(trim(token)) IN ('playstation','ps','ps4','ps5','playstation 4','playstation 5') THEN 'PLAYSTATION'::"PlatformType"
    WHEN lower(trim(token)) IN ('xbox','xbox one','xbox series','xbox series x','xbox series s') THEN 'XBOX'::"PlatformType"
    WHEN lower(trim(token)) IN ('nintendo','switch','nintendo switch') THEN 'NINTENDO'::"PlatformType"
    WHEN lower(trim(token)) IN ('android') THEN 'ANDROID'::"PlatformType"
    WHEN lower(trim(token)) IN ('ios','iphone','ipad') THEN 'IOS'::"PlatformType"
    WHEN lower(trim(token)) IN ('mac','macos','mac os') THEN 'MAC'::"PlatformType"
    WHEN lower(trim(token)) IN ('linux') THEN 'LINUX'::"PlatformType"
    WHEN lower(trim(token)) IN ('steam deck','steamdeck','steam-deck') THEN 'STEAM_DECK'::"PlatformType"
    WHEN lower(trim(token)) IN ('web','browser') THEN 'WEB'::"PlatformType"
    ELSE NULL
  END AS platform
  FROM regexp_split_to_table(coalesce(g."platform", ''), ',') AS token
) p
WHERE g."platform" IS NOT NULL
  AND trim(g."platform") <> ''
  AND p.platform IS NOT NULL
ON CONFLICT ("gameId", "platform") DO NOTHING;
