import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth";
import { guardMutation } from "@/lib/api";

// RAWG platform IDs (https://api.rawg.io/api/platforms): 3 = iOS, 21 = Android.
// Call this route with ?platforms=3,21 to import mobile games specifically.
const STORE_PRIORITY = [
  "App Store",
  "Google Play",
  "Steam",
  "Epic Games",
  "GOG",
  "PlayStation Store",
  "Xbox Store",
  "Nintendo Store",
];

interface RawgStore {
  url: string;
  store: { name: string };
}
interface RawgDetail {
  description_raw: string | null;
  stores: RawgStore[] | null;
}
interface RawgGame {
  name: string;
  slug: string;
  background_image: string | null;
  genres: { name: string }[];
  platforms: { platform: { name: string } }[] | null;
  rating: number;
  ratings_count: number;
}

async function fetchGamesPage(page: number, apiKey: string, platforms: string | null, ordering: string): Promise<RawgGame[]> {
  const params = new URLSearchParams({ key: apiKey, page: String(page), page_size: "40", ordering });
  if (platforms) params.set("platforms", platforms);
  const res = await fetch(`https://api.rawg.io/api/games?${params.toString()}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.results ?? [];
}

async function fetchGameDetail(slug: string, apiKey: string): Promise<RawgDetail | null> {
  const res = await fetch(`https://api.rawg.io/api/games/${slug}?key=${apiKey}`);
  if (!res.ok) return null;
  const detail = await res.json();

  const storesRes = await fetch(`https://api.rawg.io/api/games/${slug}/stores?key=${apiKey}`);
  const storesData = storesRes.ok ? await storesRes.json() : { results: [] };

  return {
    description_raw: detail.description_raw ?? null,
    stores: storesData.results ?? [],
  };
}

export async function GET(request: NextRequest) {
  const blocked = await guardMutation(request, "admin:games:import", 5);
  if (blocked) return blocked;

  try {
    const owner = await requireOwner();

    const RAWG_KEY = process.env.RAWG_API_KEY;
    if (!RAWG_KEY) {
      return NextResponse.json({ error: "RAWG_API_KEY missing" }, { status: 500 });
    }

    const page = Number(request.nextUrl.searchParams.get("page") ?? "1");
    const platforms = request.nextUrl.searchParams.get("platforms");
    const ordering = request.nextUrl.searchParams.get("ordering") ?? "-added";

    const games = await fetchGamesPage(page, RAWG_KEY, platforms, ordering);

    let added = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const g of games) {
      const platformNames =
        g.platforms?.map((p) => p.platform.name).filter(Boolean).join(", ") || null;
      const genre = g.genres?.[0]?.name ?? null;

      let description: string | null = null;
      let officialUrl: string | null = null;

      try {
        const detail = await fetchGameDetail(g.slug, RAWG_KEY);
        if (detail) {
          description = detail.description_raw ? detail.description_raw.slice(0, 2000) : null;
          const stores = detail.stores ?? [];
          const sorted = stores.sort((a, b) => {
            const ai = STORE_PRIORITY.indexOf(a.store?.name);
            const bi = STORE_PRIORITY.indexOf(b.store?.name);
            return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
          });
          officialUrl = sorted[0]?.url ?? null;
        }
      } catch {
        // Missing detail/store info shouldn't block importing the base record.
      }

      try {
        await db.game.create({
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
            ratingAverage: g.rating ?? 0,
            ratingCount: g.ratings_count ?? 0,
            priceCents: 0,
            published: false,
          },
        });
        added++;
      } catch (err: unknown) {
        const prismaCode = (err as { code?: string }).code;
        if (prismaCode === "P2002") {
          skipped++;
        } else {
          errors.push(`${g.name}: ${err instanceof Error ? err.message : "unknown error"}`);
        }
      }
    }

    await db.auditLog.create({
      data: {
        actorUserId: owner.id,
        action: "GAMES_BULK_IMPORT_RAWG_DETAILED",
        entityType: "Game",
        metadata: { page, platforms, added, skipped, totalFetched: games.length },
      },
    });

    return NextResponse.json({
      page,
      platforms: platforms || "all",
      totalFetched: games.length,
      added,
      skipped,
      errors: errors.slice(0, 10),
      note: "افتح نفس الرابط بتغيير رقم page للصفحة التالية حتى توصل لعدد الألعاب المطلوب",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
