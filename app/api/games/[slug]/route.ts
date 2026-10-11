import { NextRequest, NextResponse } from 'next/server';
import { db } from '../../../../lib/prisma';
import { guardRead } from '../../../../lib/api';
import { vortexScore } from '../../../../lib/game-score';
import { toPublicContent } from '../../../../lib/downloads';

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const blocked = await guardRead(request, 'games:detail');
  if (blocked) return blocked;
  try {
    const { slug } = await params;
    if (!slug || slug.length > 160) return NextResponse.json({ error: 'GAME_NOT_FOUND' }, { status: 404 });
    const game = await db.game.findFirst({ where: { slug, published: true }, include: { reviews: { orderBy: { createdAt: 'desc' }, take: 20, include: { user: { select: { username: true } } } } } });
    if (!game) return NextResponse.json({ error: 'GAME_NOT_FOUND' }, { status: 404 });
    // A failed counter update must never break the page itself.
    await db.game.update({ where: { id: game.id }, data: { viewCount: { increment: 1 } } }).catch(() => undefined);
    return NextResponse.json({ ...toPublicContent(game), vortexScore: vortexScore(game) }, { headers: { 'Cache-Control': 's-maxage=30, stale-while-revalidate=120' } });
  } catch (error) {
    console.error('GET /api/games/[slug]', error);
    return NextResponse.json({ error: 'GAME_LOAD_FAILED' }, { status: 500 });
  }
}
