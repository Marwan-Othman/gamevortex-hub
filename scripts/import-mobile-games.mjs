import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const RAWG_KEY = process.env.RAWG_API_KEY?.trim();
const TARGET = Math.min(Math.max(Number(process.env.RAWG_MOBILE_IMPORT_TARGET || 1000), 1), 5000);
const PAGE_SIZE = Math.min(Math.max(Number(process.env.RAWG_MOBILE_IMPORT_PAGE_SIZE || 40), 1), 40);
const PLATFORMS = "3,21"; // RAWG: iOS + Android
const STORE_HOSTS = new Set(["apps.apple.com", "play.google.com"]);

if (!RAWG_KEY) {
  console.error("RAWG_API_KEY is required. No fake catalog will be generated.");
  process.exit(1);
}

function isOfficialStoreUrl(value) {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && STORE_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

async function rawg(path, params = {}) {
  const query = new URLSearchParams({ key: RAWG_KEY, ...params });
  const response = await fetch(`https://api.rawg.io/api/${path}?${query}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`RAWG ${path} failed: ${response.status}`);
  return response.json();
}

async function importGame(game) {
  const details = await rawg(`games/${encodeURIComponent(game.slug)}`);
  const stores = await rawg(`games/${encodeURIComponent(game.slug)}/stores`);
  const officialStore = (stores.results || [])
    .map((item) => item.url)
    .find(isOfficialStoreUrl) || null;

  if (!officialStore) return { imported: false, reason: "no-official-mobile-store" };

  const platforms = (game.platforms || [])
    .map((item) => Number(item.platform?.id))
    .filter((id) => id === 3 || id === 21)
    .map((id) => id === 3 ? "IOS" : "ANDROID");

  const uniquePlatforms = [...new Set(platforms)];
  if (!uniquePlatforms.length) return { imported: false, reason: "not-mobile" };

  const existing = await db.game.findUnique({ where: { slug: game.slug }, select: { id: true } });
  const data = {
    titleAr: game.name,
    titleEn: game.name,
    description: typeof details.description_raw === "string" ? details.description_raw.slice(0, 4000) : null,
    platform: uniquePlatforms.join(", "),
    genre: game.genres?.[0]?.name || null,
    coverUrl: game.background_image || null,
    officialUrl: officialStore,
    downloadSource: officialStore,
    sourceStatus: "OFFICIAL_SOURCE",
    sourceProvider: "RAWG",
    ratingAverage: Number(game.rating || 0),
    ratingCount: Number(game.ratings_count || 0),
    published: true,
    gamePlatforms: {
      create: uniquePlatforms.map((platform) => ({ platform })),
    },
  };

  if (!existing) {
    await db.game.create({ data });
    return { imported: true, created: true };
  }

  await db.game.update({
    where: { id: existing.id },
    data: {
      ...data,
      gamePlatforms: undefined,
    },
  });

  for (const platform of uniquePlatforms) {
    await db.gamePlatform.upsert({
      where: { gameId_platform: { gameId: existing.id, platform } },
      create: { gameId: existing.id, platform },
      update: {},
    });
  }

  return { imported: true, created: false };
}

let imported = 0;
let inspected = 0;
let page = 1;
const failures = [];

try {
  while (imported < TARGET && page <= 250) {
    const data = await rawg("games", {
      platforms: PLATFORMS,
      page: String(page),
      page_size: String(PAGE_SIZE),
      ordering: "-added",
    });

    const games = Array.isArray(data.results) ? data.results : [];
    if (!games.length) break;

    for (const game of games) {
      if (imported >= TARGET) break;
      inspected += 1;
      try {
        const result = await importGame(game);
        if (result.imported) {
          imported += 1;
          console.log(`[${imported}/${TARGET}] ${game.name}`);
        }
      } catch (error) {
        failures.push({ slug: game.slug, error: error instanceof Error ? error.message : String(error) });
      }
    }

    page += 1;
  }

  console.log(JSON.stringify({ target: TARGET, imported, inspected, pages: page - 1, failures: failures.slice(0, 25) }, null, 2));
  if (imported < TARGET) {
    console.error(`Only ${imported} qualifying mobile games were imported. No fake records were created.`);
    process.exitCode = 2;
  }
} finally {
  await db.$disconnect();
}
