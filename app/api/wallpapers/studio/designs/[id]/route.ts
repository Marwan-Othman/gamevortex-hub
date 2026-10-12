import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/prisma";
import { getOptionalUser } from "@/lib/auth";
import { guardMutation, guardRead, internalError } from "@/lib/api";
import { getStudioAccess, prepareStudioSave, serializeDesign, studioErrorResponse } from "@/lib/wallpaper-studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };
const notFound = () => NextResponse.json({ error: "DESIGN_NOT_FOUND" }, { status: 404, headers: NO_STORE });
const validId = (id: string) => Boolean(id) && id.length <= 100;

type Ctx = { params: Promise<{ id: string }> };

// ملكية التصميم تُفرض في الاستعلام نفسه (where: { id, userId }): تصميم مستخدم آخر
// يظهر دائمًا كـ 404 ولا يكشف وجوده.

export async function GET(request: NextRequest, { params }: Ctx) {
  const blocked = await guardRead(request, "wallpapers:studio:designs:get", 120);
  if (blocked) return blocked;
  try {
    const { id } = await params;
    if (!validId(id)) return notFound();
    const user = await getOptionalUser();
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers: NO_STORE });
    const row = await db.wallpaperDesign.findFirst({ where: { id, userId: user.id } });
    if (!row) return notFound();
    return NextResponse.json({ design: serializeDesign(row) }, { headers: NO_STORE });
  } catch (error) {
    return internalError("wallpapers:studio:designs:get", error);
  }
}

export async function PUT(request: NextRequest, { params }: Ctx) {
  const blocked = await guardMutation(request, "wallpapers:studio:designs:update", 60);
  if (blocked) return blocked;
  try {
    const { id } = await params;
    if (!validId(id)) return notFound();
    const user = await getOptionalUser();
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers: NO_STORE });

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json({ error: "INVALID_JSON" }, { status: 400, headers: NO_STORE });
    }

    const existing = await db.wallpaperDesign.findFirst({ where: { id, userId: user.id }, select: { id: true } });
    if (!existing) return notFound();

    const access = await getStudioAccess(user);
    const data = await prepareStudioSave(raw, access);
    const result = await db.wallpaperDesign.updateMany({
      where: { id, userId: user.id },
      data: {
        name: data.name,
        backgroundKind: data.backgroundKind,
        backgroundWallpaperId: data.backgroundWallpaperId,
        tier: data.tier,
        document: data.document as unknown as Prisma.InputJsonValue,
      },
    });
    if (result.count === 0) return notFound();
    const row = await db.wallpaperDesign.findFirst({ where: { id, userId: user.id } });
    if (!row) return notFound();
    return NextResponse.json({ design: serializeDesign(row) }, { headers: NO_STORE });
  } catch (error) {
    return studioErrorResponse(error) ?? internalError("wallpapers:studio:designs:update", error);
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const blocked = await guardMutation(request, "wallpapers:studio:designs:delete", 60);
  if (blocked) return blocked;
  try {
    const { id } = await params;
    if (!validId(id)) return notFound();
    const user = await getOptionalUser();
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers: NO_STORE });
    const result = await db.wallpaperDesign.deleteMany({ where: { id, userId: user.id } });
    if (result.count === 0) return notFound();
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    return internalError("wallpapers:studio:designs:delete", error);
  }
}
