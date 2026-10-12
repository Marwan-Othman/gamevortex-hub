/**
 * GameVortex Wallpaper Studio — منطق الخادم المشترك بين واجهات API.
 * حالة VIP تُقرأ دائمًا من getVipAccess (قاعدة البيانات)، وليس من المتصفح.
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/prisma";
import { getVipAccess } from "@/lib/vip";
import {
  StudioPolicyError,
  assertDocumentAllowed,
  requiredTier,
  saveLimitFor,
  studioSavePayloadSchema,
  STUDIO_MAX_DOCUMENT_BYTES,
  type StudioAccessLike,
  type StudioSavePayload,
} from "@/lib/wallpaper-studio-policy";

export type StudioViewer = { id: string; role: string };

export async function getStudioAccess(user: StudioViewer): Promise<StudioAccessLike> {
  const access = await getVipAccess(user.id);
  return { isVip: access.isVip, isOwner: access.isOwner };
}

/** يتحقق من الحمولة بالكامل ويرجع بيانات جاهزة للحفظ. يرمي StudioPolicyError أو ZodError. */
export async function prepareStudioSave(raw: unknown, access: StudioAccessLike) {
  if (JSON.stringify(raw ?? null).length > STUDIO_MAX_DOCUMENT_BYTES) {
    throw new StudioPolicyError("INVALID_DESIGN", "PAYLOAD_TOO_LARGE");
  }
  const payload: StudioSavePayload = studioSavePayloadSchema.parse(raw);
  assertDocumentAllowed(payload.document, access);

  let backgroundWallpaperId: string | null = null;
  if (payload.background.kind === "library") {
    const wallpaper = await db.wallpaper.findUnique({
      where: { id: payload.background.wallpaperId },
      select: { id: true, isVip: true, published: true, moderationStatus: true, mediaType: true },
    });
    if (!wallpaper || !wallpaper.published || wallpaper.moderationStatus !== "APPROVED" || wallpaper.mediaType !== "IMAGE") {
      throw new StudioPolicyError("INVALID_DESIGN", "BACKGROUND_NOT_FOUND");
    }
    if (wallpaper.isVip && !access.isVip && !access.isOwner) throw new StudioPolicyError("VIP_REQUIRED");
    backgroundWallpaperId = wallpaper.id;
  }

  // الصورة الخاصة تبقى في متصفح المستخدم؛ نحفظ فقط معرّفها المحلي مع التصميم.
  const document =
    payload.background.kind === "local"
      ? { ...payload.document, local: { localId: payload.background.localId } }
      : payload.document;

  return {
    name: payload.name,
    backgroundKind: payload.background.kind,
    backgroundWallpaperId,
    tier: requiredTier(payload.document),
    document,
  };
}

export async function assertWithinSaveLimit(userId: string, access: StudioAccessLike) {
  const limit = saveLimitFor(access);
  if (limit === null) return;
  const count = await db.wallpaperDesign.count({ where: { userId } });
  if (count >= limit) throw new StudioPolicyError("SAVE_LIMIT_REACHED");
}

/** يرجع الشكل المرسل للمتصفح. معرّف الصورة الخاصة يُقرأ من document.local. */
export function serializeDesign(row: {
  id: string;
  name: string;
  backgroundKind: string;
  backgroundWallpaperId: string | null;
  tier: string;
  document: unknown;
  createdAt: Date;
  updatedAt: Date;
}) {
  const doc = row.document as { local?: { localId?: string } } | null;
  return {
    id: row.id,
    name: row.name,
    tier: row.tier,
    background:
      row.backgroundKind === "library" && row.backgroundWallpaperId
        ? { kind: "library" as const, wallpaperId: row.backgroundWallpaperId }
        : row.backgroundKind === "local" && doc?.local?.localId
          ? { kind: "local" as const, localId: doc.local.localId }
          : { kind: "none" as const },
    document: row.document,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** يحوّل أخطاء السياسة/التحقق إلى استجابة JSON صادقة؛ يرجع null لأي خطأ آخر. */
export function studioErrorResponse(error: unknown) {
  const headers = { "Cache-Control": "private, no-store" };
  if (error instanceof StudioPolicyError) {
    const status = error.code === "VIP_REQUIRED" ? 403 : error.code === "SAVE_LIMIT_REACHED" ? 409 : 400;
    return NextResponse.json(
      { error: error.code, detail: error.message !== error.code ? error.message : undefined },
      { status, headers },
    );
  }
  if (error instanceof Error && error.name === "ZodError") {
    return NextResponse.json({ error: "INVALID_DESIGN" }, { status: 400, headers });
  }
  return null;
}
