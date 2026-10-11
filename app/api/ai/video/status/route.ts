import { NextRequest, NextResponse } from "next/server";
import { getOptionalUser } from "@/lib/auth";
import { guardRead, internalError } from "@/lib/api";
import { refundAiCredit } from "@/lib/ai/credits";
import { createMediaToken, readMediaToken } from "@/lib/ai/media-token";
import { getCompletedVideoUri, getVideoOperation } from "@/lib/ai/media";
import { guardUser } from "@/lib/ai/http";
import { recordMediaUsage } from "@/lib/ai/media-usage";
import { getVipAccess } from "@/lib/vip";
import { AiProviderError } from "@/lib/ai/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/ai/video/status?token=...
 * 200 { data: { status: "processing" } }
 * 200 { data: { status: "completed", videoUrl } }
 * 200 { data: { status: "failed", refunded: boolean } }   (credits are refunded once)
 */
export async function GET(request: NextRequest) {
  const blocked = await guardRead(request, "ai:video-status", 60);
  if (blocked) return blocked;

  let user: Awaited<ReturnType<typeof getOptionalUser>>;
  try {
    user = await getOptionalUser();
  } catch (error) {
    return internalError("ai:video-status:auth", error, "AI_STATUS_FAILED");
  }
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const limited = await guardUser(user.id, "ai:video-status", 30);
  if (limited) return limited;

  const token = request.nextUrl.searchParams.get("token") || "";
  const data = readMediaToken(token);
  if (!data || data.kind !== "VIDEO" || data.sub !== user.id || data.fileUri) {
    return NextResponse.json({ error: "INVALID_MEDIA_TOKEN" }, { status: 400 });
  }

  // Owners are never charged, so there is nothing to refund (and no reservation to find).
  const owner = (await getVipAccess(user.id).catch(() => null))?.isOwner === true;

  async function fail(errorCode: string) {
    let refunded = false;
    if (!owner) {
      refunded = await refundAiCredit(user!.id, "VIDEO", data!.creditKey, data!.creditAmount).then(() => true).catch(() => false);
    }
    await recordMediaUsage({
      userId: user!.id,
      operation: "VIDEO",
      idempotencyKey: data!.creditKey,
      requestId: data!.creditKey,
      status: "FAILED",
      gvcUsed: owner ? 0 : data!.creditAmount,
      gvcRefunded: refunded ? data!.creditAmount : 0,
      errorCode,
    });
    return NextResponse.json({ data: { status: "failed", refunded } }, { status: 200 });
  }

  let operation: Record<string, unknown>;
  try {
    operation = await getVideoOperation(data.interactionId);
  } catch (error) {
    // Transient problems keep the client polling; permanent ones (operation gone,
    // rejected, malformed) will never succeed, so refund instead of leaving the
    // user waiting on a video that cannot arrive.
    const permanent = error instanceof AiProviderError && !error.retryable && !error.failoverable;
    if (permanent) return fail(error.code);
    return NextResponse.json({ data: { status: "processing" } }, { status: 200 });
  }

  if (operation.done !== true) {
    return NextResponse.json({ data: { status: "processing" } }, { status: 200 });
  }

  if (operation.error && typeof operation.error === "object") return fail("VIDEO_GENERATION_FAILED");

  const fileUri = getCompletedVideoUri(operation);
  if (!fileUri) return fail("VIDEO_EMPTY_RESPONSE");

  await recordMediaUsage({
    userId: user.id,
    operation: "VIDEO",
    idempotencyKey: data.creditKey,
    requestId: data.creditKey,
    status: "COMPLETED",
    gvcUsed: owner ? 0 : data.creditAmount,
  });

  const completedToken = createMediaToken({
    sub: user.id,
    interactionId: data.interactionId,
    fileUri,
    kind: "VIDEO",
    creditKey: data.creditKey,
    creditAmount: data.creditAmount,
    ttlSeconds: 60 * 60,
  });

  return NextResponse.json({
    data: {
      status: "completed",
      videoUrl: "/api/ai/video/file?token=" + encodeURIComponent(completedToken),
    },
  }, { headers: { "Cache-Control": "private, no-store" } });
}
