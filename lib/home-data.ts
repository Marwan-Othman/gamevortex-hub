import { unstable_cache } from "next/cache";
import { db } from "./prisma";

/**
 * Public home-page data (Phase 16).
 *
 * Every visitor used to trigger six database queries per request (4 `findMany` that returned
 * full rows, including long descriptions and screenshot arrays, plus 2 counts). The data is
 * identical for all visitors and changes slowly, so it is cached for 60 s and shared across
 * requests. Only the columns the UI renders are selected.
 *
 * Admin writes show up within one minute; call `revalidateTag("home-catalog", "max")`
 * from an admin mutation if instant freshness is ever needed.
 */
export const HOME_CATALOG_TAG = "home-catalog";
export const HOME_REVALIDATE_SECONDS = 60;

const gameCardSelect = {
  id: true,
  slug: true,
  titleAr: true,
  titleEn: true,
  coverUrl: true,
  platform: true,
  ratingAverage: true,
  ratingCount: true,
  playCount: true,
  viewCount: true,
  featured: true,
} as const;

export type HomeGame = {
  id: string;
  slug: string;
  titleAr: string;
  titleEn: string;
  coverUrl: string | null;
  platform: string | null;
  ratingAverage: number;
  ratingCount: number;
  playCount: number;
  viewCount: number;
  featured: boolean;
};

export type HomeApp = {
  id: string;
  slug: string;
  nameAr: string;
  nameEn: string;
  developer: string | null;
};

export type HomeData = {
  newest: HomeGame[];
  rated: HomeGame[];
  played: HomeGame[];
  apps: HomeApp[];
  gamesCount: number;
  appsCount: number;
};

async function loadHomeData(): Promise<HomeData> {
  const [newest, rated, played, apps, gamesCount, appsCount] = await Promise.all([
    db.game.findMany({
      where: { published: true },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: gameCardSelect,
    }),
    db.game.findMany({
      where: { published: true },
      orderBy: [{ ratingAverage: "desc" }, { ratingCount: "desc" }],
      take: 10,
      select: gameCardSelect,
    }),
    db.game.findMany({
      where: { published: true },
      orderBy: [{ playCount: "desc" }, { viewCount: "desc" }],
      take: 10,
      select: gameCardSelect,
    }),
    db.app.findMany({
      where: { published: true },
      orderBy: [{ featured: "desc" }, { createdAt: "desc" }],
      take: 6,
      select: { id: true, slug: true, nameAr: true, nameEn: true, developer: true },
    }),
    db.game.count({ where: { published: true } }),
    db.app.count({ where: { published: true } }),
  ]);

  return { newest, rated, played, apps, gamesCount, appsCount };
}

const getCachedHomeData = unstable_cache(loadHomeData, ["home-data-v1"], {
  revalidate: HOME_REVALIDATE_SECONDS,
  tags: [HOME_CATALOG_TAG],
});

const EMPTY: HomeData = { newest: [], rated: [], played: [], apps: [], gamesCount: 0, appsCount: 0 };

/**
 * Never throws: an unavailable database renders the page shell and empty
 * catalog rails instead of turning every homepage request into a 500.
 *
 * Important: do not blindly retry an unstable_cache miss. Next's cache wrapper
 * can reject after the underlying Prisma load fails; retrying six parallel
 * queries immediately adds pressure to the same exhausted connection pool.
 * The cache remains the first attempt; on failure we log only a safe error
 * name and return the static fallback. Recovery is naturally retried by the
 * next request after the cache miss has settled.
 */
export async function getHomeData(): Promise<HomeData> {
  try {
    return await getCachedHomeData();
  } catch (error) {
    // Public output must not disclose database hosts, SQL, or Prisma internals.
    console.error("Home catalog temporarily unavailable", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return EMPTY;
  }
}
