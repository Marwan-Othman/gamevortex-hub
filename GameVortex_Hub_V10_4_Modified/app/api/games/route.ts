import { NextRequest, NextResponse } from 'next/server';
import { db } from '../../../lib/prisma';
import { guardRead } from '../../../lib/api';
import { vortexScore } from '../../../lib/game-score';

export async function GET(request: NextRequest) {
  const blocked = await guardRead(request, 'games:list');
  if (blocked) return blocked;
  const page = Math.max(1, Number(request.nextUrl.searchParams.get('page') || 1));
  const limit = Math.min(50, Math.max(1, Number(request.nextUrl.searchParams.get('limit') || 24)));
  const skip = (page - 1) * limit;
  const [games, total] = await Promise.all([
    db.game.findMany({ where: { published: true }, orderBy: [{ featured: 'desc' }, { ratingAverage: 'desc' }, { updatedAt: 'desc' }], skip, take: limit }),
    db.game.count({ where: { published: true } })
  ]);
  return NextResponse.json({ games: games.map(g => ({ ...g, vortexScore: vortexScore(g) })), page, limit, total, pages: Math.ceil(total / limit) }, { headers: { 'Cache-Control': 's-maxage=30, stale-while-revalidate=120' } });
}
