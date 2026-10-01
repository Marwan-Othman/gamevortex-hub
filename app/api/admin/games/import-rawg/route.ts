import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth";
import { guardMutation } from "@/lib/api";
import type { PlatformType, Prisma } from "@prisma/client";
import { ensureCategoryIds } from "@/lib/categories";

const RAWG_PLATFORM_IDS = new Set(["3", "21"]);
const STORE_PRIORITY = [
  "App Store",
  "Apple App Store",
  "Google Play",
  "Steam",
  "Epic Games",
  "GOG",
  "PlayStation Store",
  "Xbox Store",
  "Nintendo Store",
];
const ALLOWED_ORDERINGS = new Set([
  "-added",
  "added",
  "-rating",
  "rating",
  "-metacritic",
  "metacritic",
  "-released",
  "released",
]);

interface RawgStore {
  url: string;
  store?: { name?: string };
}
interface RawgDetail {
  description_raw?: string | null;
  stores?: RawgStore[] | null;
}
interface RawgPlatform {
  platform?: { id?: number; name?: string };
}
interface RawgGame {
  name: string;
  slug: string;
  background_image: string | null;
  genres?: { name: string }[];
  platforms?: RawgPlatform[] | null;
  rating: number;
  ratings_count: number;
}

function getRequestedPlatforms(value: string | null): Set<string> {
  if (!value) return new Set();
  return new Set(value.split(",").map((v) => v.trim()).filter((v) => RAWG_PLATFORM_IDS.has(v)));
}

function mapRawgPlatforms(platforms: RawgPlatform[] | null | undefined): PlatformType[] {
  const result = new Set<PlatformType>();
  for (const item of platforms ?? []) {
    const id = String(item.platform?.id ?? "");
    if (id === "21") result.add("ANDROID");
    if (id === "3") result.add("IOS");
  }
  return [...result];
}

function isValidHttpUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function isOfficialMobileStoreUrl(value: string | null | undefined): boolean {
  if (!value || !isValidHttpUrl(value)) return false;
  const hostname = new URL(value).hostname.toLowerCase();
  return hostname === "apps.apple.com" || hostname === "play.google.com";
}

function pickOfficialUrl(stores: RawgStore[], mobileOnly: boolean): string | null {
  const candidates = stores.filter((store) => isValidHttpUrl(store.url));
  const filtered = mobileOnly
    ? candidates.filter((store) => isOfficialMobileStoreUrl(store.url))
    : candidates;

  const sorted = [...filtered].sort((a, b) => {
    const ai = STORE_PRIORITY.indexOf(a.store?.name ?? "");
    const bi = STORE_PRIORITY.indexOf(b.store?.name ?? "");
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  return sorted[0]?.url ?? null;
}

async function fetchGamesPage(
  page: number,
  apiKey: string,
  platforms: string | null,
  ordering: string,
): Promise<RawgGame[]> {
  const params = new URLSearchParams({
    key: apiKey,
    page: String(page),
    page_size: "40",
    ordering,
  });
  if (platforms) params.set("platforms", platforms);

  const res = await fetch(`https://api.rawg.io/api/games?${params.toString()}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`RAWG games request failed: ${res.status}`);
  const data = (await res.json()) as { results?: RawgGame[] };
  return data.results ?? [];
}

async function fetchGameDetail(slug: string, apiKey: string): Promise<RawgDetail | null> {
  const res = await fetch(`https://api.rawg.io/api/games/${encodeURIComponent(slug)}?key=${apiKey}`, {
    cache: "no-store",
  });
  if (!res.ok) return null;
  const detail = (await res.json()) as RawgDetail;

  const storesRes = await fetch(
    `https://api.rawg.io/api/games/${encodeURIComponent(slug)}/stores?key=${apiKey}`,
    { cache: "no-store" },
  );
  const storesData = storesRes.ok ? ((await storesRes.json()) as { results?: RawgStore[] }) : { results: [] };

  return {
    description_raw: detail.description_raw ?? null,
    stores: storesData.results ?? [],
  };
}

async function runImport(request: NextRequest) {
  const blocked = await guardMutation(request, "admin:games:import", 5);
  if (blocked) return blocked;

  try {
    const owner = await requireOwner();
    const RAWG_KEY = process.env.RAWG_API_KEY;
    if (!RAWG_KEY) return NextResponse.json({ error: "RAWG_API_KEY missing" }, { status: 500 });

    const params = request.nextUrl.searchParams;
    const page = Math.max(1, Number(params.get("page") ?? "1") || 1);
    const platforms = params.get("platforms");
    const requestedPlatforms = getRequestedPlatforms(platforms);
    const rawOrdering = params.get("ordering") ?? "-added";
    const ordering = ALLOWED_ORDERINGS.has(rawOrdering) ? rawOrdering : "-added";
    const mobileOnly = requestedPlatforms.size > 0 && [...requestedPlatforms].every((id) => id === "3" || id === "21");

    const games = await fetchGamesPage(page, RAWG_KEY, platforms, ordering);
    let added = 0;
    let updated = 0;
    let skipped = 0;
    let withoutOfficialStore = 0;
    const errors: string[] = [];

    for (const g of games) {
      const mappedPlatforms = mapRawgPlatforms(g.platforms);
      const platformNames = mappedPlatforms.length > 0
        ? mappedPlatforms.join(",")
        : null;
      const genre = g.genres?.[0]?.name ?? null;
      const categoryIds = await ensureCategoryIds(db, genre ? [genre] : []);

      let description: string | null = null;
      let officialUrl: string | null = null;
      try {
        const detail = await fetchGameDetail(g.slug, RAWG_KEY);
        if (detail) {
          description = detail.description_raw ? detail.description_raw.slice(0, 2000) : null;
          officialUrl = pickOfficialUrl(detail.stores ?? [], mobileOnly);
        }
      } catch (error) {
        errors.push(`${g.name}: detail fetch failed`);
      }

      if (mobileOnly && mappedPlatforms.length === 0) {
        skipped++;
        continue;
      }
      if (mobileOnly && !officialUrl) withoutOfficialStore++;

      try {
        const existing = await db.game.findUnique({
          where: { slug: g.slug },
          select: { id: true, officialUrl: true, downloadSource: true },
        });

        if (!existing) {
          const created = await db.game.create({
            data: {
              slug: g.slug,
              titleAr: g.name,
              titleEn: g.name,
              description,
              coverUrl: g.background_image,
              platform: platformNames,
              genre,
              officialUrl,
              downloadSource: officialUrl,
              sourceProvider: "RAWG",
              ratingAverage: g.rating ?? 0,
              ratingCount: g.ratings_count ?? 0,
              priceCents: 0,
              published: false,
              gamePlatforms: {
                create: mappedPlatforms.map((platform) => ({ platform })),
              },
              gameCategories: {
                create: categoryIds.map((categoryId) => ({ categoryId })),
              },
            },
          });
          void created;
          added++;
          continue;
        }

        const data: Prisma.GameUpdateInput = {
          sourceProvider: "RAWG",
          platform: platformNames ?? undefined,
          genre: genre ?? undefined,
          description: description ?? undefined,
          coverUrl: g.background_image ?? undefined,
          ratingAverage: g.rating ?? undefined,
          ratingCount: g.ratings_count ?? undefined,
          gamePlatforms: {
            deleteMany: {},
            create: mappedPlatforms.map((platform) => ({ platform })),
          },
          gameCategories: {
            deleteMany: {},
            create: categoryIds.map((categoryId) => ({ categoryId })),
          },
        };
        if (!existing.officialUrl && officialUrl) {
          data.officialUrl = officialUrl;
          data.downloadSource = officialUrl;
        }

        await db.game.update({ where: { id: existing.id }, data });
        if (mappedPlatforms.length) {
          await db.gamePlatform.createMany({
            data: mappedPlatforms.map((platform) => ({ gameId: existing.id, platform })),
            skipDuplicates: true,
          });
        }
        updated++;
      } catch (error) {
        errors.push(`${g.name}: ${error instanceof Error ? error.message : "unknown error"}`);
      }
    }

    await db.auditLog.create({
      data: {
        actorUserId: owner.id,
        action: "GAMES_BULK_IMPORT_RAWG_DETAILED",
        entityType: "Game",
        metadata: {
          page,
          platforms,
          ordering,
          added,
          updated,
          skipped,
          withoutOfficialStore,
          totalFetched: games.length,
        },
      },
    });

    return NextResponse.json({
      page,
      platforms: platforms || "all",
      ordering,
      totalFetched: games.length,
      added,
      updated,
      skipped,
      withoutOfficialStore,
      errors: errors.slice(0, 10),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  return runImport(request);
}

export async function GET() {
  return NextResponse.json(
    { error: "Method Not Allowed. Use POST for game imports." },
    { status: 405, headers: { Allow: "POST" } },
  );
}
