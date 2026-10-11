import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getOptionalUser } from "@/lib/auth";
import { guardMutation } from "@/lib/api";
import { consumeAiCredit, refundAiCredit } from "@/lib/ai/credits";
import { getAiCost } from "@/lib/ai/costs";
import { startVideo } from "@/lib/ai/media";
import { createMediaToken } from "@/lib/ai/media-token";
import {
  aiErrorCode,
  aiErrorResponse,
  guardUser,
  MAX_IMAGE_DATA_CHARS,
  parseImageData,
  pickVideoAspectRatio,
  pickVideoResolution,
  readIdempotencyKey,
} from "@/lib/ai/http";
import { recordMediaUsage } from "@/lib/ai/media-usage";
import { getVipAccess } from "@/lib/vip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/ai/video  (starts a long-running generation, does not wait for it)
 * Request : { prompt, imageData?, aspectRatio?, resolution?, idempotencyKey? }
 * Success : 200 { data: { status: "processing", token, requestId, provider, model } }
 * Then    : GET /api/ai/video/status?token=...  ->  { data: { status, videoUrl? } }
 *           GET /api/ai/video/file?token=...    ->  the mp4 stream
 */
export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  const blocked = await guardMutation(request, "ai:video", 6);
  if (blocked) return blocked;

  // A database failure while reading the session must answer JSON (503), not throw out of the handler.
  let user: Awaited<ReturnType<typeof getOptionalUser>>;
  try {
    user = await getOptionalUser();
  } catch (error) {
    return aiErrorResponse(error, requestId, "ai_auth_failure");
  }
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED", requestId }, { status: 401 });

  const limited = await guardUser(user.id, "ai:video", 2);
  if (limited) return limited;

  const body = await request.json().catch(() => null);
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  const imageData = typeof body?.imageData === "string" && body.imageData ? body.imageData : undefined;
  const aspectRatio = pickVideoAspectRatio(body?.aspectRatio);
  const resolution = pickVideoResolution(body?.resolution);
  // The credit reservation is keyed by this value. Using a fresh server-side id
  // for every call (the old behaviour) made a double-click or a client retry
  // start - and charge - a second video.
  const idempotencyKey = readIdempotencyKey(body?.idempotencyKey, requestId);

  if (!prompt || prompt.length > 4000 || !idempotencyKey || aspectRatio === null || resolution === null) {
    return NextResponse.json({ error: "INVALID_REQUEST", requestId }, { status: 400 });
  }
  if (imageData) {
    if (imageData.length > MAX_IMAGE_DATA_CHARS) return NextResponse.json({ error: "INVALID_REQUEST", requestId }, { status: 413 });
    try { parseImageData(imageData); } catch { return NextResponse.json({ error: "INVALID_IMAGE_INPUT", requestId }, { status: 400 }); }
  }

  let vip: Awaited<ReturnType<typeof getVipAccess>>;
  try {
    vip = await getVipAccess(user.id);
  } catch (error) {
    return aiErrorResponse(error, requestId, "ai_vip_lookup_failure");
  }
  if (!vip.isVip) return NextResponse.json({ error: "AI_VIP_REQUIRED", requestId }, { status: 403 });

  const cost = getAiCost(imageData ? "VIDEO_EDIT_COST" : "VIDEO_COST");
  const owner = vip.isOwner;
  let reserved = false;

  try {
    if (!owner) {
      const reservation = await consumeAiCredit(user.id, "VIDEO", idempotencyKey, cost);
      // Same key already paid for a video that was started earlier: never start (or charge) another.
      if (reservation.alreadyApplied) throw new Error("AI_REQUEST_IN_PROGRESS");
      reserved = true;
    }

    const result = await startVideo({ prompt, imageData, aspectRatio, resolution });
    const token = createMediaToken({
      sub: user.id,
      interactionId: result.interactionId,
      kind: "VIDEO",
      creditKey: idempotencyKey,
      creditAmount: cost,
      ttlSeconds: 6 * 60 * 60,
    });

    return NextResponse.json({
      data: { status: "processing", token, requestId, provider: "gemini", model: result.model },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    let refunded = 0;
    if (reserved) {
      refunded = await refundAiCredit(user.id, "VIDEO", idempotencyKey, cost).then(() => cost).catch(() => 0);
    }
    const code = aiErrorCode(error);
    if (code !== "AI_REQUEST_IN_PROGRESS" && code !== "AI_IDEMPOTENCY_KEY_CONFLICT") {
      await recordMediaUsage({ userId: user.id, operation: "VIDEO", idempotencyKey, requestId, status: "FAILED", gvcUsed: 0, gvcRefunded: refunded, errorCode: code });
    }
    return aiErrorResponse(error, requestId, "ai_video_failure");
  }
}
