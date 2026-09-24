import { NextRequest, NextResponse } from 'next/server';
import { db } from '../../../../lib/prisma';
import { guardRead } from '../../../../lib/api';
import { vortexScore } from '../../../../lib/game-score';

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const blocked = await guardRead(request, 'games:detail');
  if (blocked) return blocked;
  const { slug } = await params;
  const game = await db.game.findFirst({ where: { slug, published: true }, include: { reviews: { orderBy: { createdAt: 'desc' }, take: 20, include: { user: { select: { username: true } } } } } });
  if (!game) return NextResponse.json({ error: 'GAME_NOT_FOUND' }, { status: 404 });
  await db.game.update({ where: { id: game.id }, data: { viewCount: { increment: 1 } } });
  return NextResponse.json({ ...game, vortexScore: vortexScore(game) }, { headers: { 'Cache-Control': 's-maxage=30, stale-while-revalidate=120' } });
}
