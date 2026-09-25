import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { guardMutation, guardRead } from "@/lib/api";
import { awardActionXp, createActivity } from "@/lib/gamer";

const statuses = new Set(["WANT", "PLAYING", "BEATEN", "ARCHIVED"]);

export async function GET(request: NextRequest) {
  const blocked = await guardRead(request, "games:library:read"); if (blocked) return blocked;
  try {
    const user = await requireUser();
    const status = request.nextUrl.searchParams.get("status");
    const gameId = request.nextUrl.searchParams.get("gameId");
    const items = await db.gameLibraryItem.findMany({ where: { userId: user.id, ...(gameId ? { gameId } : {}), ...(status && statuses.has(status) ? { status: status as any } : {}) }, include: { game: true }, orderBy: { updatedAt: "desc" } });
    return NextResponse.json(items);
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "UNAUTHORIZED" }, { status: 401 }); }
}

export async function POST(request: NextRequest) {
  const blocked = await guardMutation(request, "games:library", 30); if (blocked) return blocked;
  try {
    const user = await requireUser();
    const body = await request.json();
    const gameId = String(body.gameId || ""); const status = String(body.status || "WANT");
    if (!gameId || !statuses.has(status)) return NextResponse.json({ error: "INVALID_LIBRARY_ITEM" }, { status: 400 });
    const game = await db.game.findFirst({ where: { id: gameId, published: true } }); if (!game) return NextResponse.json({ error: "GAME_NOT_FOUND" }, { status: 404 });
    const existed = await db.gameLibraryItem.findUnique({ where: { userId_gameId: { userId: user.id, gameId } } });
    const item = await db.gameLibraryItem.upsert({ where: { userId_gameId: { userId: user.id, gameId } }, create: { userId: user.id, gameId, status: status as any }, update: { status: status as any } });
    if (!existed) { await awardActionXp(user.id, "ADDED_TO_LIBRARY", gameId); await createActivity(user.id, "ADDED_TO_LIBRARY", gameId, `Added ${game.titleEn} to library`); }
    if (status === "BEATEN" && existed?.status !== "BEATEN") { await awardActionXp(user.id, "COMPLETED_GAME", gameId); await createActivity(user.id, "COMPLETED_GAME", gameId, `Completed ${game.titleEn}`); }
    return NextResponse.json(item, { status: existed ? 200 : 201 });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "BAD_REQUEST" }, { status: 400 }); }
}

export async function DELETE(request: NextRequest) {
  const blocked = await guardMutation(request, "games:library", 30); if (blocked) return blocked;
  try { const user = await requireUser(); const gameId = request.nextUrl.searchParams.get("gameId"); if (!gameId) return NextResponse.json({ error: "GAME_ID_REQUIRED" }, { status: 400 }); await db.gameLibraryItem.deleteMany({ where: { userId: user.id, gameId } }); return NextResponse.json({ ok: true }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "FAILED" }, { status: 400 }); }
}
