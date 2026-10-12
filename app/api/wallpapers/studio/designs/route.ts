import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/prisma";
import { getOptionalUser } from "@/lib/auth";
import { guardMutation, guardRead, internalError } from "@/lib/api";
import {
  assertWithinSaveLimit,
  getStudioAccess,
  prepareStudioSave,
  serializeDesign,
  studioErrorResponse,
} from "@/lib/wallpaper-studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

/** قائمة تصاميم المستخدم الحالي فقط (بدون محتوى الطبقات). */
export async function GET(request: NextRequest) {
  const blocked = await guardRead(request, "wallpapers:studio:designs:list", 60);
  if (blocked) return blocked;
  try {
    const user = await getOptionalUser();
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers: NO_STORE });
    const [rows, access] = await Promise.all([
      db.wallpaperDesign.findMany({
        where: { userId: user.id },
        orderBy: { updatedAt: "desc" },
        take: 100,
        select: { id: true, name: true, tier: true, backgroundKind: true, backgroundWallpaperId: true, updatedAt: true },
      }),
      getStudioAccess(user),
    ]);
    return NextResponse.json(
      {
        designs: rows.map((r) => ({
          id: r.id,
          name: r.name,
          tier: r.tier,
          backgroundKind: r.backgroundKind,
          backgroundWallpaperId: r.backgroundWallpaperId,
          updatedAt: r.updatedAt.toISOString(),
        })),
        isVip: access.isVip,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    return internalError("wallpapers:studio:designs:list", error);
  }
}

export async function POST(request: NextRequest) {
  const blocked = await guardMutation(request, "wallpapers:studio:designs:create", 30);
  if (blocked) return blocked;
  try {
    const user = await getOptionalUser();
    if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401, headers: NO_STORE });

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json({ error: "INVALID_JSON" }, { status: 400, headers: NO_STORE });
    }

    const access = await getStudioAccess(user);
    const data = await prepareStudioSave(raw, access);
    await assertWithinSaveLimit(user.id, access);

    const row = await db.wallpaperDesign.create({
      data: {
        userId: user.id,
        name: data.name,
        backgroundKind: data.backgroundKind,
        backgroundWallpaperId: data.backgroundWallpaperId,
        tier: data.tier,
        document: data.document as unknown as Prisma.InputJsonValue,
      },
    });
    return NextResponse.json({ design: serializeDesign(row) }, { status: 201, headers: NO_STORE });
  } catch (error) {
    return studioErrorResponse(error) ?? internalError("wallpapers:studio:designs:create", error);
  }
}
