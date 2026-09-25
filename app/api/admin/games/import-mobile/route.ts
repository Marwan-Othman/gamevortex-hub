import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth";
import { guardMutation } from "@/lib/api";
import { PlatformType, SourceStatus } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RAWG_PLATFORMS = new Set<number>([3, 21]);
const MOBILE_STORE_HOSTS = new Set<string>([
  "apps.apple.com",
  "play.google.com",
]);

function isOfficialMobileUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;

  try {
    const url = new URL(value);

    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      MOBILE_STORE_HOSTS.has(url.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

async function rawg(
  path: string,
  key: string,
  params: Record<string, string>,
): Promise<any> {
  const query = new URLSearchParams({
    key,
    ...params,
  });

  const response = await fetch(
    `https://api.rawg.io/api/${path}?${query}`,
    {
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error(`RAWG request failed: ${response.status}`);
  }

  return response.json();
}

export async function POST(request: NextRequest) {
  const blocked = await guardMutation(
    request,
    "admin:games:import-mobile",
    2,
  );

  if (blocked) return blocked;

  try {
    const owner = await requireOwner();

    const key = process.env.RAWG_API_KEY?.trim();

    if (!key) {
      return NextResponse.json(
        { error: "RAWG_API_KEY missing" },
        { status: 503 },
      );
    }

    const target = Math.min(
      Math.max(
        Number(request.nextUrl.searchParams.get("target") || 25),
        1,
      ),
      100,
    );

    const page = Math.min(
      Math.max(
        Number(request.nextUrl.searchParams.get("page") || 1),
        1,
      ),
      250,
    );

    const data = await rawg("games", key, {
      platforms: "3,21",
      page: String(page),
      page_size: "40",
      ordering: "-added",
    });

    const games = Array.isArray(data.results) ? data.results : [];

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const game of games) {
      if (created + updated >= target) {
        break;
      }

      if (!game?.slug || typeof game.slug !== "string") {
        skipped += 1;
        continue;
      }

      const detail = await rawg(
        `games/${encodeURIComponent(game.slug)}`,
        key,
        {},
      );

      const stores = await rawg(
        `games/${encodeURIComponent(game.slug)}/stores`,
        key,
        {},
      );

      const officialUrl =
        (Array.isArray(stores.results)
          ? stores.results
          : []
        )
          .map((item: any) => item?.url)
          .find(isOfficialMobileUrl) || null;

      const platforms: number[] = (
        Array.isArray(game.platforms) ? game.platforms : []
      )
        .map((item: any) => Number(item?.platform?.id))
        .filter((id: number) => RAWG_PLATFORMS.has(id));

      const mapped: PlatformType[] = Array.from(
        new Set<PlatformType>(
          platforms
            .map((id: number): PlatformType | null => {
              if (id === 3) {
                return PlatformType.IOS;
              }

              if (id === 21) {
                return PlatformType.ANDROID;
              }

              return null;
            })
            .filter(
              (platform): platform is PlatformType =>
                platform !== null,
            ),
        ),
      );

      if (!officialUrl || mapped.length === 0) {
        skipped += 1;
        continue;
      }

      const existing = await db.game.findUnique({
        where: {
          slug: game.slug,
        },
        select: {
          id: true,
          officialUrl: true,
        },
      });

      const common = {
        slug: game.slug,
        titleAr: game.name,
        titleEn: game.name,
        description:
          typeof detail.description_raw === "string"
            ? detail.description_raw.slice(0, 4000)
            : null,
        platform: mapped.join(", "),
        genre: game.genres?.[0]?.name || null,
        coverUrl: game.background_image || null,
        officialUrl,
        downloadSource: officialUrl,
        sourceStatus: SourceStatus.OFFICIAL_SOURCE,
        sourceProvider: "RAWG",
        ratingAverage: Number(game.rating || 0),
        ratingCount: Number(game.ratings_count || 0),
        published: true,
      };

      if (!existing) {
        await db.game.create({
          data: {
            ...common,
            gamePlatforms: {
              create: mapped.map((platform) => ({
                platform,
              })),
            },
          },
        });

        created += 1;
      } else {
        await db.game.update({
          where: {
            id: existing.id,
          },
          data: common,
        });

        for (const platform of mapped) {
          await db.gamePlatform.upsert({
            where: {
              gameId_platform: {
                gameId: existing.id,
                platform,
              },
            },
            create: {
              gameId: existing.id,
              platform,
            },
            update: {},
          });
        }

        updated += 1;
      }
    }

    await db.auditLog.create({
      data: {
        actorUserId: owner.id,
        action: "GAMES_MOBILE_IMPORT_RAWG_OFFICIAL_STORES",
        entityType: "Game",
        metadata: {
          page,
          target,
          created,
          updated,
          skipped,
        },
      },
    });

    return NextResponse.json({
      ok: true,
      page,
      target,
      created,
      updated,
      skipped,
      imported: created + updated,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "MOBILE_IMPORT_FAILED",
      },
      { status: 500 },
    );
  }
}
