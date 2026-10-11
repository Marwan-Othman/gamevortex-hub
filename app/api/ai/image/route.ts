import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getOptionalUser } from "@/lib/auth";
import { guardMutation } from "@/lib/api";
import { consumeAiCredit, refundAiCredit } from "@/lib/ai/credits";
import { getAiCost } from "@/lib/ai/costs";
import { generateImage } from "@/lib/ai/media";
import {
  aiErrorCode,
  aiErrorResponse,
  guardUser,
  MAX_IMAGE_DATA_CHARS,
  parseImageData,
  pickAspectRatio,
  pickImageSize,
  readIdempotencyKey,
} from "@/lib/ai/http";
import { recordMediaUsage } from "@/lib/ai/media-usage";
import { getVipAccess } from "@/lib/vip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/ai/image
 * Request : { prompt, imageData?, aspectRatio?, imageSize?, idempotencyKey? }
 * Success : 200 with the raw image bytes (Content-Type: image/png|jpeg|webp).
 *           components/ai/AiMediaClient.tsx reads response.blob().
 * Failure : { error: <code>, requestId } JSON.
 */
export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  const blocked = await guardMutation(request, "ai:image", 10);
  if (blocked) return blocked;

  // A database failure while reading the session must answer JSON (503), not throw out of the handler.
  let user: Awaited<ReturnType<typeof getOptionalUser>>;
  try {
    user = await getOptionalUser();
  } catch (error) {
    return aiErrorResponse(error, requestId, "ai_auth_failure");
  }
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED", requestId }, { status: 401 });

  const limited = await guardUser(user.id, "ai:image", 4);
  if (limited) return limited;

  const body = await request.json().catch(() => null);
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  const imageData = typeof body?.imageData === "string" && body.imageData ? body.imageData : undefined;
  const aspectRatio = pickAspectRatio(body?.aspectRatio);
  const imageSize = pickImageSize(body?.imageSize);
  const idempotencyKey = readIdempotencyKey(body?.idempotencyKey, requestId);

  if (!prompt || prompt.length > 4000 || !idempotencyKey || aspectRatio === null || imageSize === null) {
    return NextResponse.json({ error: "INVALID_REQUEST", requestId }, { status: 400 });
  }
  if (imageData) {
    if (imageData.length > MAX_IMAGE_DATA_CHARS) return NextResponse.json({ error: "INVALID_REQUEST", requestId }, { status: 413 });
    // Validate before any credit is taken.
    try { parseImageData(imageData); } catch { return NextResponse.json({ error: "INVALID_IMAGE_INPUT", requestId }, { status: 400 }); }
  }

  let vip: Awaited<ReturnType<typeof getVipAccess>>;
  try {
    vip = await getVipAccess(user.id);
  } catch (error) {
    return aiErrorResponse(error, requestId, "ai_vip_lookup_failure");
  }
  if (!vip.isVip) return NextResponse.json({ error: "AI_VIP_REQUIRED", requestId }, { status: 403 });

  const costKey = imageData ? "IMAGE_EDIT_COST" : imageSize === "2K" || imageSize === "4K" ? "HIGH_QUALITY_IMAGE_COST" : "IMAGE_COST";
  const cost = getAiCost(costKey);
  const owner = vip.isOwner;
  let reserved = false;

  try {
    if (!owner) {
      const reservation = await consumeAiCredit(user.id, "IMAGE", idempotencyKey, cost);
      // The same key already paid for an earlier request. Generating again
      // would be free work, so a replay is refused instead of served.
      if (reservation.alreadyApplied) throw new Error("AI_REQUEST_IN_PROGRESS");
      reserved = true;
    }
    const result = await generateImage({ prompt, imageData, aspectRatio, imageSize });
    const bytes = Buffer.from(result.data, "base64");
    if (!bytes.length) throw new Error("AI_EMPTY_RESPONSE");

    await recordMediaUsage({ userId: user.id, operation: "IMAGE", idempotencyKey, requestId, status: "COMPLETED", gvcUsed: owner ? 0 : cost });
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": result.mimeType,
        "Content-Length": String(bytes.length),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Request-Id": requestId,
      },
    });
  } catch (error) {
    let refunded = 0;
    if (reserved) {
      refunded = await refundAiCredit(user.id, "IMAGE", idempotencyKey, cost).then(() => cost).catch(() => 0);
    }
    if (aiErrorCode(error) !== "AI_REQUEST_IN_PROGRESS" && aiErrorCode(error) !== "AI_IDEMPOTENCY_KEY_CONFLICT") {
      await recordMediaUsage({ userId: user.id, operation: "IMAGE", idempotencyKey, requestId, status: "FAILED", gvcUsed: 0, gvcRefunded: refunded, errorCode: aiErrorCode(error) });
    }
    return aiErrorResponse(error, requestId, "ai_image_failure");
  }
}
