import { NextRequest, NextResponse } from "next/server";
import { db } from "../../../lib/prisma";
import { guardRead, internalError } from "../../../lib/api";
import { vortexScore } from "../../../lib/game-score";
import { toPublicContent } from "../../../lib/downloads";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const blocked = await guardRead(req, "search", 90);
  if (blocked) return blocked;
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  // Empty / oversized queries are not an error: the UI shows its normal "no results" state.
  if (!q || q.length > 100) return NextResponse.json({ games: [], apps: [] });

  try {
    const categoryMatch = {
      category: {
        OR: [
          { nameAr: { contains: q, mode: "insensitive" as const } },
          { nameEn: { contains: q, mode: "insensitive" as const } },
        ],
      },
    };
    const [games, apps] = await Promise.all([
      db.game.findMany({
        where: {
          published: true,
          OR: [
            { titleAr: { contains: q, mode: "insensitive" } },
            { titleEn: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
            { gameCategories: { some: categoryMatch } },
          ],
        },
        orderBy: [{ featured: "desc" }, { ratingAverage: "desc" }, { viewCount: "desc" }],
        take: 30,
        include: { gamePlatforms: true, gameCategories: { include: { category: true } } },
      }),
      db.app.findMany({
        where: {
          published: true,
          OR: [
            { nameAr: { contains: q, mode: "insensitive" } },
            { nameEn: { contains: q, mode: "insensitive" } },
            { developer: { contains: q, mode: "insensitive" } },
            { appCategories: { some: categoryMatch } },
          ],
        },
        orderBy: [{ featured: "desc" }, { ratingAverage: "desc" }, { viewCount: "desc" }],
        take: 30,
        include: { appPlatforms: true, appCategories: { include: { category: true } } },
      }),
    ]);
    return NextResponse.json(
      {
        games: games.map((g) => ({ ...toPublicContent(g), vortexScore: vortexScore(g) })),
        apps: apps.map(toPublicContent),
      },
      { headers: { "Cache-Control": "s-maxage=30, stale-while-revalidate=120" } },
    );
  } catch (error) {
    return internalError("search", error, "SEARCH_FAILED");
  }
}
