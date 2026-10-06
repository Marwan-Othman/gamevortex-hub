import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { db } from "@/lib/prisma";
import { getOptionalUser } from "@/lib/auth";
import { guardMutation, guardRead } from "@/lib/api";
import { getVipAccess } from "@/lib/vip";
import { consumeAiCredit, refundAiCredit } from "@/lib/ai-media/credits";
import { getImageCost, getAiCost } from "@/lib/ai-media/costs";
import { geminiImage } from "@/lib/ai/gemini";
import { geminiVideo } from "@/lib/ai/gemini-video";
import { finishAiUsage, startAiUsage } from "@/lib/gamevortex-ai/usage-ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_PROMPT = 4000;
const MAX_INPUT_BYTES = 10 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 50 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function safeError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  const allowed = new Set(["UNAUTHORIZED", "AI_VIP_REQUIRED", "AI_CREDITS_EXHAUSTED", "INVALID_REQUEST", "CONVERSATION_NOT_FOUND"]);
  return allowed.has(code) ? code : "AI_MEDIA_GENERATION_FAILED";
}

function extension(mime: string) {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  if (mime === "video/webm") return "webm";
  return mime.startsWith("video/") ? "mp4" : "png";
}

export async function GET(request: NextRequest) {
  const blocked = await guardRead(request, "ai:media:read", 120);
  if (blocked) return blocked;
  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const conversationId = request.nextUrl.searchParams.get("conversationId");
  if (!conversationId) return NextResponse.json({ jobs: [] });
  const jobs = await db.aiMediaJob.findMany({
    where: { userId: user.id, conversationId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, kind: true, status: true, prompt: true, resultUrl: true, createdAt: true },
  });
  return NextResponse.json({ jobs });
}

export async function POST(request: NextRequest) {
  const blocked = await guardMutation(request, "ai:media:generate", 4);
  if (blocked) return blocked;
  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  let input: Record<string, unknown>;
  let image: { base64: string; mimeType: string } | undefined;
  try {
    if ((request.headers.get("content-type") || "").includes("multipart/form-data")) {
      const form = await request.formData();
      input = Object.fromEntries(form.entries());
      const file = form.get("image");
      if (file instanceof File && file.size > 0) {
        if (!IMAGE_TYPES.has(file.type)) return NextResponse.json({ error: "INVALID_IMAGE_TYPE" }, { status: 400 });
        if (file.size > MAX_INPUT_BYTES) return NextResponse.json({ error: "IMAGE_TOO_LARGE" }, { status: 413 });
        image = { base64: Buffer.from(await file.arrayBuffer()).toString("base64"), mimeType: file.type };
      }
    } else {
      const body = await request.json();
      if (!body || typeof body !== "object") throw new Error("INVALID_REQUEST");
      input = body as Record<string, unknown>;
    }
  } catch {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }

  const kind = input.kind === "VIDEO" ? "VIDEO" : input.kind === "IMAGE" ? "IMAGE" : "";
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  const conversationId = typeof input.conversationId === "string" && input.conversationId.trim() ? input.conversationId.trim() : null;
  const idempotencyKey = typeof input.idempotencyKey === "string" && input.idempotencyKey.trim() ? input.idempotencyKey.trim() : crypto.randomUUID();

  if (!kind || !prompt || prompt.length > MAX_PROMPT) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });

  const existing = await db.aiMediaJob.findUnique({ where: { idempotencyKey }, select: { id: true, userId: true, kind: true, status: true, prompt: true, resultUrl: true, createdAt: true } });
  if (existing) {
    if (existing.userId !== user.id) return NextResponse.json({ error: "IDEMPOTENCY_CONFLICT" }, { status: 409 });
    return NextResponse.json({ job: existing });
  }

  const vip = await getVipAccess(user.id);
  if (!vip.isVip) return NextResponse.json({ error: "AI_VIP_REQUIRED" }, { status: 403 });

  if (conversationId) {
    const conversation = await db.gameVortexAiConversation.findFirst({ where: { id: conversationId, userId: user.id }, select: { id: true } });
    if (!conversation) return NextResponse.json({ error: "CONVERSATION_NOT_FOUND" }, { status: 404 });
  }

  const operation = input.operation === "EDIT" || input.operation === "ENHANCE" || input.operation === "TRANSFORM" ? input.operation : "GENERATE";
  const cost = kind === "VIDEO" ? getAiCost(image ? "VIDEO_EDIT_COST" : "VIDEO_COST") : getImageCost(operation === "GENERATE" && !image ? "GENERATE" : operation, typeof input.quality === "string" ? input.quality : undefined);
  const owner = vip.isOwner;

  if (!owner) await consumeAiCredit(user.id, kind === "VIDEO" ? "VIDEO" : "IMAGE", idempotencyKey, cost);

  let jobId = "";
  let usageId = "";
  try {
    const job = await db.aiMediaJob.create({
      data: {
        userId: user.id,
        kind,
        provider: "GEMINI",
        model: kind === "VIDEO" ? (process.env.GEMINI_VIDEO_MODEL || "gemini-omni-flash-preview") : (process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image"),
        prompt: prompt,
        status: "PROCESSING",
        conversationId,
        idempotencyKey,
      },
    });
    jobId = job.id;
    const usage = await startAiUsage({
      userId: user.id,
      provider: "gemini",
      operation: kind + "_" + operation,
      idempotencyKey: idempotencyKey + ":attempt:gemini",
      gvcReserved: owner ? 0 : cost,
    });
    usageId = usage.usage.id;
  } catch (error) {
    if (!owner) await refundAiCredit(user.id, kind === "VIDEO" ? "VIDEO" : "IMAGE", idempotencyKey, cost).catch(() => undefined);
    throw error;
  }

  try {
    let buffer: Buffer;
    let mimeType: string;
    let model: string;
    let providerTaskId: string | undefined;

    if (kind === "IMAGE") {
      const result = await geminiImage({
        prompt,
        aspectRatio: typeof input.aspectRatio === "string" ? input.aspectRatio : "1:1",
        imageSize: input.imageSize === "512" || input.imageSize === "2K" || input.imageSize === "4K" ? input.imageSize : "1K",
        inputImage: image,
      });
      buffer = Buffer.from(result.base64, "base64");
      mimeType = result.mimeType;
      model = result.model;
    } else {
      const result = await geminiVideo(prompt, image);
      buffer = result.buffer;
      mimeType = result.mimeType;
      model = result.model;
      providerTaskId = result.operationName;
    }

    if (!buffer.length || buffer.length > MAX_OUTPUT_BYTES) throw new Error("AI_MEDIA_OUTPUT_INVALID");

    const blob = await put("ai/generated/" + user.id + "/" + crypto.randomUUID() + "." + extension(mimeType), buffer, {
      access: "public",
      contentType: mimeType,
      addRandomSuffix: false,
    });

    await db.aiMediaJob.update({
      where: { id: jobId },
      data: { status: "COMPLETED", resultUrl: blob.url, providerTaskId, model },
    });
    await finishAiUsage(usageId, user.id, { status: "COMPLETED", gvcUsed: owner ? 0 : cost });

    return NextResponse.json({ job: { id: jobId, kind, status: "COMPLETED", prompt, resultUrl: blob.url } });
  } catch (error) {
    await db.aiMediaJob.update({ where: { id: jobId }, data: { status: "FAILED", errorMessage: "AI_MEDIA_GENERATION_FAILED" } }).catch(() => undefined);
    await finishAiUsage(usageId, user.id, { status: "FAILED", gvcUsed: 0, errorCode: safeError(error) }).catch(() => undefined);
    if (!owner) await refundAiCredit(user.id, kind === "VIDEO" ? "VIDEO" : "IMAGE", idempotencyKey, cost).catch(() => undefined);
    const code = safeError(error);
    const status = code === "AI_CREDITS_EXHAUSTED" ? 402 : code === "AI_VIP_REQUIRED" ? 403 : code === "CONVERSATION_NOT_FOUND" ? 404 : code === "INVALID_REQUEST" ? 400 : 503;
    console.error(JSON.stringify({ event: "ai_media_failure", requestId: idempotencyKey, code }));
    return NextResponse.json({ error: code }, { status });
  }
}
