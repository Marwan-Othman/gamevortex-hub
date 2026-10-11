import { NextRequest, NextResponse } from 'next/server';
import { db } from '../../../../../lib/prisma';
import { requireUser } from '../../../../../lib/auth';
import { guardMutation, guardRead, userRouteError } from '../../../../../lib/api';
import { awardActionXp, createActivity } from '../../../../../lib/gamer';
import { toPublicContent } from '../../../../../lib/downloads';

export async function GET(request: NextRequest) {
  const blocked = await guardRead(request, 'games:favorites:read'); if (blocked) return blocked;
  try { const u = await requireUser(); const items = await db.favoriteGame.findMany({ where: { userId: u.id }, include: { game: true }, orderBy: { createdAt: 'desc' } }); return NextResponse.json(items.map((item) => ({ ...item, game: toPublicContent(item.game) }))); }
  catch (e) { return userRouteError(e, 'FAVORITES_LOAD_FAILED', 'me:favorites:get'); }
}
export async function POST(request: NextRequest) {
  const blocked = await guardMutation(request, 'games:favorites', 30); if (blocked) return blocked;
  try { const u = await requireUser(); const body = await request.json(); const gameId = String(body.gameId || ''); if (!gameId) return NextResponse.json({error:'GAME_ID_REQUIRED'},{status:400}); const game = await db.game.findFirst({ where: { id: gameId, published: true } }); if (!game) return NextResponse.json({ error: 'GAME_NOT_FOUND' }, { status: 404 }); const existed = await db.favoriteGame.findUnique({ where: { userId_gameId: { userId: u.id, gameId } } }); const item = await db.favoriteGame.upsert({ where: { userId_gameId: { userId: u.id, gameId } }, create: { userId: u.id, gameId }, update: {} }); if (!existed) { await awardActionXp(u.id, 'FAVORITED_GAME', gameId); await createActivity(u.id, 'FAVORITED_GAME', gameId, `Favorited ${game.titleEn}`); } return NextResponse.json(item, { status: existed ? 200 : 201 }); }
  catch (e) { return userRouteError(e, 'FAVORITES_UPDATE_FAILED', 'me:favorites:post'); }
}
export async function DELETE(request: NextRequest) {
  const blocked = await guardMutation(request, 'games:favorites', 30); if (blocked) return blocked;
  try { const u = await requireUser(); const id = request.nextUrl.searchParams.get('gameId'); if (!id) return NextResponse.json({ error: 'gameId required' }, { status: 400 }); await db.favoriteGame.deleteMany({ where: { userId: u.id, gameId: id } }); return NextResponse.json({ ok: true }); }
  catch (e) { return userRouteError(e, 'FAVORITES_DELETE_FAILED', 'me:favorites:delete'); }
}
