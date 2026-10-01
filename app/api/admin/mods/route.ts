import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth";
import { guardMutation, guardRead } from "@/lib/api";

const schema = z.object({
  slug: z.string().trim().min(2).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  titleAr: z.string().trim().min(1).max(160),
  titleEn: z.string().trim().min(1).max(160),
  descriptionAr: z.string().trim().max(4000).optional().default(""),
  descriptionEn: z.string().trim().max(4000).optional().default(""),
  imageUrl: z.string().trim().url().max(2000).optional().or(z.literal("")),
  modUrl: z.string().trim().url().max(2000).optional().or(z.literal("")),
  downloadUrl: z.string().trim().url().max(2000).optional().or(z.literal("")),
  sourceUrl: z.string().trim().url().max(2000).optional().or(z.literal("")),
  sourceProvider: z.string().trim().max(120).optional().or(z.literal("")),
  platform: z.enum(["PC","PLAYSTATION","XBOX","NINTENDO","ANDROID","IOS","MAC","LINUX","STEAM_DECK","WEB"]).optional().or(z.literal("")),
  gameId: z.string().cuid().optional().or(z.literal("")),
  published: z.boolean().default(false),
  featured: z.boolean().default(false),
  sortOrder: z.number().int().min(-100000).max(100000).default(0),
});

export async function GET(req: NextRequest) {
  const blocked = await guardRead(req, "admin:mods", 60);
  if (blocked) return blocked;
  try {
    await requireOwner();
    return NextResponse.json({ mods: await db.mod.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }], take: 250 }) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "FORBIDDEN";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500 });
  }
}

export async function POST(req: NextRequest) {
  const blocked = await guardMutation(req, "admin:mods:create", 30);
  if (blocked) return blocked;
  try {
    const owner = await requireOwner();
    const input = schema.parse(await req.json());
    if (input.gameId) {
      const game = await db.game.findUnique({ where: { id: input.gameId }, select: { id: true } });
      if (!game) return NextResponse.json({ error: "GAME_NOT_FOUND" }, { status: 404 });
    }
    const mod = await db.mod.create({ data: { ...input, platform: input.platform || null, gameId: input.gameId || null, descriptionAr: input.descriptionAr || null, descriptionEn: input.descriptionEn || null, imageUrl: input.imageUrl || null, modUrl: input.modUrl || null, downloadUrl: input.downloadUrl || null, sourceUrl: input.sourceUrl || null, sourceProvider: input.sourceProvider || null } });
    await db.auditLog.create({ data: { actorUserId: owner.id, action: "MOD_CREATED", entityType: "Mod", entityId: mod.id, metadata: { slug: mod.slug, published: mod.published } } });
    return NextResponse.json({ mod }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "INVALID_MOD", details: error.issues }, { status: 400 });
    const message = error instanceof Error ? error.message : "MOD_CREATE_FAILED";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500 });
  }
}


export async function PATCH(req: NextRequest) {
  const blocked = await guardMutation(req, "admin:mods:update", 30);
  if (blocked) return blocked;
  try {
    const owner = await requireOwner();
    const id = req.nextUrl.searchParams.get("id") || "";
    if (!id) return NextResponse.json({ error: "MOD_ID_REQUIRED" }, { status: 400 });
    const input = schema.partial().parse(await req.json());
    const mod = await db.mod.update({
      where: { id },
      data: {
        ...input,
        platform: input.platform === "" ? null : input.platform,
        gameId: input.gameId === "" ? null : input.gameId,
        descriptionAr: input.descriptionAr === "" ? null : input.descriptionAr,
        descriptionEn: input.descriptionEn === "" ? null : input.descriptionEn,
        imageUrl: input.imageUrl === "" ? null : input.imageUrl,
        modUrl: input.modUrl === "" ? null : input.modUrl,
        downloadUrl: input.downloadUrl === "" ? null : input.downloadUrl,
        sourceUrl: input.sourceUrl === "" ? null : input.sourceUrl,
        sourceProvider: input.sourceProvider === "" ? null : input.sourceProvider,
      },
    });
    await db.auditLog.create({ data: { actorUserId: owner.id, action: "MOD_UPDATED", entityType: "Mod", entityId: mod.id, metadata: { published: mod.published } } });
    return NextResponse.json({ mod });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "INVALID_MOD", details: error.issues }, { status: 400 });
    const message = error instanceof Error ? error.message : "MOD_UPDATE_FAILED";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const blocked = await guardMutation(req, "admin:mods:delete", 20);
  if (blocked) return blocked;
  try {
    const owner = await requireOwner();
    const id = req.nextUrl.searchParams.get("id") || "";
    if (!id) return NextResponse.json({ error: "MOD_ID_REQUIRED" }, { status: 400 });
    await db.mod.delete({ where: { id } });
    await db.auditLog.create({ data: { actorUserId: owner.id, action: "MOD_DELETED", entityType: "Mod", entityId: id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "MOD_DELETE_FAILED";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500 });
  }
}
