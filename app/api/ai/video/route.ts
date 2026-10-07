import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getOptionalUser } from "@/lib/auth";
import { guardMutation } from "@/lib/api";
import { consumeAiCredit, refundAiCredit } from "@/lib/ai/credits";
import { getAiCost } from "@/lib/ai/costs";
import { startVideo } from "@/lib/ai/media";
import { createMediaToken } from "@/lib/ai/media-token";
import { getVipAccess } from "@/lib/vip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function safeError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  const known = new Set([
    "UNAUTHORIZED",
    "AI_VIP_REQUIRED",
    "AI_CREDITS_EXHAUSTED",
    "INVALID_REQUEST",
    "INVALID_IMAGE_INPUT",
    "AI_SERVICE_UNAVAILABLE",
  ]);
  return known.has(code) ? code : "AI_SERVICE_UNAVAILABLE";
}

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  const blocked = await guardMutation(request, "ai:video", 2);
  if (blocked) return blocked;

  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED", requestId }, { status: 401 });

  const body = await request.json().catch(() => null);
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  const imageData = typeof body?.imageData === "string" ? body.imageData : undefined;
  const aspectRatio = typeof body?.aspectRatio === "string" ? body.aspectRatio : undefined;
  const resolution = typeof body?.resolution === "string" ? body.resolution : undefined;

  if (!prompt || prompt.length > 4000) {
    return NextResponse.json({ error: "INVALID_REQUEST", requestId }, { status: 400 });
  }
  if (imageData && imageData.length > 4_000_000) {
    return NextResponse.json({ error: "INVALID_REQUEST", requestId }, { status: 413 });
  }

  const vip = await getVipAccess(user.id);
  if (!vip.isVip) return NextResponse.json({ error: "AI_VIP_REQUIRED", requestId }, { status: 403 });

  const creditKey = requestId;
  const cost = getAiCost(imageData ? "VIDEO_EDIT_COST" : "VIDEO_COST");
  const owner = vip.isOwner;
  let reserved = false;

  try {
    if (!owner) {
      await consumeAiCredit(user.id, "VIDEO", creditKey, cost);
      reserved = true;
    }

    const result = await startVideo({ prompt, imageData, aspectRatio, resolution });
    const token = createMediaToken({
      sub: user.id,
      interactionId: result.interactionId,
      kind: "VIDEO",
      creditKey,
      creditAmount: cost,
      ttlSeconds: 6 * 60 * 60,
    });

    return NextResponse.json({
      data: {
        status: "processing",
        token,
        requestId,
        provider: "gemini",
        model: result.model,
      },
    });
  } catch (error) {
    if (reserved) await refundAiCredit(user.id, "VIDEO", creditKey, cost).catch(() => undefined);
    const code = safeError(error);
    const status = code === "AI_CREDITS_EXHAUSTED"
      ? 402
      : code === "AI_VIP_REQUIRED"
        ? 403
        : code === "INVALID_REQUEST" || code === "INVALID_IMAGE_INPUT"
          ? 400
          : 503;
    console.error(JSON.stringify({ event: "ai_video_failure", requestId, code }));
    return NextResponse.json({ error: code, requestId }, { status });
  }
}
