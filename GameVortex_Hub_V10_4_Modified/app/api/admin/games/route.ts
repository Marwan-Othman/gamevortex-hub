import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth";
import { guardMutation, guardRead } from "@/lib/api";

const gameSchema = z.object({
  slug: z.string().trim().min(2).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  titleAr: z.string().trim().min(1).max(180),
  titleEn: z.string().trim().min(1).max(180),
  description: z.string().trim().max(10000).optional().nullable(),
  platform: z.string().trim().max(40).optional().nullable(),
  genre: z.string().trim().max(80).optional().nullable(),
  priceCents: z.number().int().min(0).max(100000000).default(0),
  discountPercent: z.number().int().min(0).max(100).default(0),
  coverUrl: z.string().url().optional().nullable(),
  officialUrl: z.string().url().optional().nullable(),
  downloadSource: z.string().url().optional().nullable(),
  sourceStatus: z.enum(["VERIFIED","NEEDS_SOURCE","PENDING_REVIEW","UNPUBLISHED","OFFICIAL_SOURCE","NEEDS_LICENSE","STREAM_ONLY"]).default("NEEDS_SOURCE"),
  published: z.boolean().default(false),
  featured: z.boolean().default(false),
});

const clean = (x: z.infer<typeof gameSchema>) => ({
  ...x,
  description: x.description || null, platform: x.platform || null, genre: x.genre || null,
  coverUrl: x.coverUrl || null, officialUrl: x.officialUrl || null, downloadSource: x.downloadSource || null,
});

export async function GET(request: NextRequest) {
  const blocked = await guardRead(request, "admin:games", 60); if (blocked) return blocked;
  try {
    await requireOwner();
    const games = await db.game.findMany({ orderBy: { updatedAt: "desc" }, take: 200 });
    return NextResponse.json(games);
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "FORBIDDEN" }, { status: 403 }); }
}

export async function POST(request: NextRequest) {
  const blocked = await guardMutation(request, "admin:games", 30); if (blocked) return blocked;
  try {
    const owner = await requireOwner();
    const body = gameSchema.parse(await request.json());
    if (body.published && !["VERIFIED","OFFICIAL_SOURCE"].includes(body.sourceStatus)) return NextResponse.json({ error: "PUBLISHED_GAME_REQUIRES_VERIFIED_SOURCE" }, { status: 400 });
    const game = await db.game.create({ data: clean(body) });
    await db.auditLog.create({ data: { actorUserId: owner.id, action: "GAME_CREATED", entityType: "Game", entityId: game.id, metadata: { slug: game.slug } } });
    return NextResponse.json(game, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "INVALID_GAME_INPUT" }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "GAME_CREATE_FAILED" }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  const blocked = await guardMutation(request, "admin:games", 30); if (blocked) return blocked;
  try {
    const owner = await requireOwner();
    const payload = await request.json();
    const id = z.string().cuid().parse(payload.id);
    const body = gameSchema.partial().parse(payload);
    delete (body as Record<string, unknown>).id;
    const current = await db.game.findUnique({ where: { id } });
    if (!current) return NextResponse.json({ error: "GAME_NOT_FOUND" }, { status: 404 });
    const nextPublished = body.published ?? current.published;
    const nextSource = body.sourceStatus ?? current.sourceStatus;
    if (nextPublished && !["VERIFIED","OFFICIAL_SOURCE"].includes(nextSource)) return NextResponse.json({ error: "PUBLISHED_GAME_REQUIRES_VERIFIED_SOURCE" }, { status: 400 });
    const game = await db.game.update({ where: { id }, data: body as any });
    await db.auditLog.create({ data: { actorUserId: owner.id, action: "GAME_UPDATED", entityType: "Game", entityId: id, metadata: { changed: Object.keys(body) } } });
    return NextResponse.json(game);
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "INVALID_GAME_INPUT" }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "GAME_UPDATE_FAILED" }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const blocked = await guardMutation(request, "admin:games", 20); if (blocked) return blocked;
  try {
    const owner = await requireOwner();
    const id = z.string().cuid().parse(request.nextUrl.searchParams.get("id"));
    const game = await db.game.update({ where: { id }, data: { published: false, featured: false } });
    await db.auditLog.create({ data: { actorUserId: owner.id, action: "GAME_UNPUBLISHED", entityType: "Game", entityId: id } });
    return NextResponse.json({ ok: true, game });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "GAME_ARCHIVE_FAILED" }, { status: 400 }); }
}
