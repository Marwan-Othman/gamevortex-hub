import { NextRequest, NextResponse } from 'next/server';
import { db } from '../../../lib/prisma';
import { guardRead } from '../../../lib/api';
import { vortexScore } from '../../../lib/game-score';

export async function GET(req: NextRequest) {
  const blocked = await guardRead(req, 'search', 90);
  if (blocked) return blocked;
  const q = req.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (!q || q.length > 100) return NextResponse.json([]);
  const games = await db.game.findMany({ where: { published: true, OR: [
    { titleAr: { contains: q, mode: 'insensitive' } }, { titleEn: { contains: q, mode: 'insensitive' } },
    { description: { contains: q, mode: 'insensitive' } }, { platform: { contains: q, mode: 'insensitive' } }, { genre: { contains: q, mode: 'insensitive' } }
  ] }, orderBy: [{ featured: 'desc' }, { ratingAverage: 'desc' }, { viewCount: 'desc' }], take: 50 });
  return NextResponse.json(games.map(g => ({ ...g, vortexScore: vortexScore(g) })), { headers: { 'Cache-Control': 's-maxage=30, stale-while-revalidate=120' } });
}
