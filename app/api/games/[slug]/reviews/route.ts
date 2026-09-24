import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '../../../../../lib/prisma';
import { requireUser } from '../../../../../lib/auth';
import { guardMutation } from '../../../../../lib/api';
import { awardActionXp, createActivity } from '../../../../../lib/gamer';

const reviewSchema = z.object({ rating: z.number().int().min(1).max(5), text: z.string().trim().max(2000).optional().nullable() });

export async function GET(_request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const user = await requireUser();
    const { slug } = await params;
    const game = await db.game.findFirst({ where: { slug, published: true }, select: { id: true } });
    if (!game) return NextResponse.json({ error: 'GAME_NOT_FOUND' }, { status: 404 });
    const review = await db.review.findUnique({ where: { userId_gameId: { userId: user.id, gameId: game.id } }, select: { id: true, rating: true, text: true } });
    return NextResponse.json(review);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNAUTHORIZED';
    return NextResponse.json({ error: message }, { status: message === 'UNAUTHORIZED' ? 401 : 400 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const blocked = await guardMutation(request, 'games:review', 10);
  if (blocked) return blocked;
  try {
    const user = await requireUser();
    const { slug } = await params;
    const body = reviewSchema.parse(await request.json());
    const game = await db.game.findFirst({ where: { slug, published: true } });
    if (!game) return NextResponse.json({ error: 'GAME_NOT_FOUND' }, { status: 404 });
    const existed = await db.review.findUnique({ where: { userId_gameId: { userId: user.id, gameId: game.id } } }); const review = await db.$transaction(async tx => {
      const item = await tx.review.upsert({ where: { userId_gameId: { userId: user.id, gameId: game.id } }, create: { userId: user.id, gameId: game.id, rating: body.rating, text: body.text || null }, update: { rating: body.rating, text: body.text || null } });
      const aggregate = await tx.review.aggregate({ where: { gameId: game.id }, _avg: { rating: true }, _count: { _all: true } });
      await tx.game.update({ where: { id: game.id }, data: { ratingAverage: aggregate._avg.rating || 0, ratingCount: aggregate._count._all } });
      await tx.auditLog.create({ data: { actorUserId: user.id, action: 'GAME_REVIEW_UPSERTED', entityType: 'Review', entityId: item.id, metadata: { gameId: game.id, rating: body.rating } } });
      return item;
    });
    if (!existed) { await awardActionXp(user.id, 'REVIEWED_GAME', game.id); await createActivity(user.id, 'REVIEWED_GAME', game.id, `Reviewed ${game.titleEn}`); }
    return NextResponse.json(review, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') }, { status: 400 });
    const message = error instanceof Error ? error.message : 'REVIEW_FAILED';
    return NextResponse.json({ error: message }, { status: message === 'UNAUTHORIZED' ? 401 : 400 });
  }
}
