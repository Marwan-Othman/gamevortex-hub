import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getOptionalUser } from "@/lib/auth";
import { guardMutation } from "@/lib/api";
import { consumeAiCredit, refundAiCredit } from "@/lib/ai/credits";
import { getAiCost } from "@/lib/ai/costs";
import { generateImage } from "@/lib/ai/media";
import { getVipAccess } from "@/lib/vip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function safeError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  const known = new Set(["UNAUTHORIZED", "AI_VIP_REQUIRED", "AI_CREDITS_EXHAUSTED", "INVALID_REQUEST", "INVALID_IMAGE_INPUT", "AI_SERVICE_UNAVAILABLE"]);
  return known.has(code) ? code : "AI_SERVICE_UNAVAILABLE";
}

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  const blocked = await guardMutation(request, "ai:image", 4);
  if (blocked) return blocked;

  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED", requestId }, { status: 401 });

  const body = await request.json().catch(() => null);
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  const imageData = typeof body?.imageData === "string" ? body.imageData : undefined;
  const aspectRatio = typeof body?.aspectRatio === "string" ? body.aspectRatio : undefined;
  const imageSize = typeof body?.imageSize === "string" ? body.imageSize : undefined;
  const idempotencyKey = typeof body?.idempotencyKey === "string" && body.idempotencyKey.trim() ? body.idempotencyKey.trim() : requestId;

  if (!prompt || prompt.length > 4000) return NextResponse.json({ error: "INVALID_REQUEST", requestId }, { status: 400 });
  if (imageData && imageData.length > 4_000_000) return NextResponse.json({ error: "INVALID_REQUEST", requestId }, { status: 413 });

  const vip = await getVipAccess(user.id);
  if (!vip.isVip) return NextResponse.json({ error: "AI_VIP_REQUIRED", requestId }, { status: 403 });

  const costKey = imageData ? "IMAGE_EDIT_COST" : imageSize === "2K" || imageSize === "4K" ? "HIGH_QUALITY_IMAGE_COST" : "IMAGE_COST";
  const cost = getAiCost(costKey);
  const owner = vip.isOwner;
  let reserved = false;

  try {
    if (!owner) {
      await consumeAiCredit(user.id, "IMAGE", idempotencyKey, cost);
      reserved = true;
    }
    const result = await generateImage({ prompt, imageData, aspectRatio, imageSize });
    const bytes = Buffer.from(result.data, "base64");
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": result.mimeType,
        "Cache-Control": "private, no-store",
        "X-Request-Id": requestId,
      },
    });
  } catch (error) {
    if (reserved) await refundAiCredit(user.id, "IMAGE", idempotencyKey, cost).catch(() => undefined);
    const code = safeError(error);
    const status = code === "AI_CREDITS_EXHAUSTED" ? 402 : code === "AI_VIP_REQUIRED" ? 403 : code === "INVALID_REQUEST" || code === "INVALID_IMAGE_INPUT" ? 400 : 503;
    console.error(JSON.stringify({ event: "ai_image_failure", requestId, code }));
    return NextResponse.json({ error: code, requestId }, { status });
  }
}
