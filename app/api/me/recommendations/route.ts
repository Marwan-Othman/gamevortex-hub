import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { guardRead, userRouteError } from "@/lib/api";
import { vortexScore } from "@/lib/game-score";
import { toPublicContent } from "@/lib/downloads";

function tokens(value?: string | null) { return (value || "").toLowerCase().split(/[,|/]+/).map(x => x.trim()).filter(Boolean); }

export async function GET(request: NextRequest) {
  const blocked = await guardRead(request, "recommendations", 60); if (blocked) return blocked;
  try {
    const user = await requireUser();
    // Phase 16: signals only need id/genre/platform, and candidates only the card fields
    // (+ downloadSource/sourceStatus for hasDownload). The old `include: { game: true }` loaded
    // up to 600 whole Game rows (descriptions, screenshots...) on every request.
    const signalGame = { select: { id: true, genre: true, platform: true } } as const;
    const [library, favorites, wishlist, games] = await Promise.all([
      db.gameLibraryItem.findMany({ where: { userId: user.id }, select: { game: signalGame }, take: 100 }),
      db.favoriteGame.findMany({ where: { userId: user.id }, select: { game: signalGame }, take: 100 }),
      db.wishlistGame.findMany({ where: { userId: user.id }, select: { game: signalGame }, take: 100 }),
      db.game.findMany({
        where: { published: true },
        take: 300,
        orderBy: [{ featured: "desc" }, { ratingAverage: "desc" }, { viewCount: "desc" }],
        select: {
          id: true, slug: true, titleAr: true, titleEn: true, coverUrl: true, genre: true, platform: true,
          ratingAverage: true, ratingCount: true, playCount: true, viewCount: true, featured: true,
          downloadSource: true, sourceStatus: true,
        },
      }),
    ]);
    const signals = [...library.map(x => x.game), ...favorites.map(x => x.game), ...wishlist.map(x => x.game)];
    const genres = new Set(signals.flatMap(g => tokens(g.genre)));
    const platforms = new Set(signals.flatMap(g => tokens(g.platform)));
    const excluded = new Set(signals.map(g => g.id));
    const recommendations = games.filter(g => !excluded.has(g.id)).map(g => {
      const genreHit = tokens(g.genre).filter(x => genres.has(x)).length;
      const platformHit = tokens(g.platform).filter(x => platforms.has(x)).length;
      const score = Math.round(vortexScore(g) * 0.55 + Math.min(30, genreHit * 12) + Math.min(15, platformHit * 8));
      return { game: toPublicContent(g), recommendationScore: Math.min(100, score), reasons: [genreHit ? "genre_match" : null, platformHit ? "platform_match" : null, g.featured ? "featured" : null].filter(Boolean) };
    }).sort((a,b) => b.recommendationScore-a.recommendationScore).slice(0, 12);
    return NextResponse.json({ recommendations, engine: "Vortex Local Recommender v1" }, { headers: { "Cache-Control": "private, max-age=60" } });
  } catch (e) { return userRouteError(e, "RECOMMENDATIONS_FAILED"); }
}
