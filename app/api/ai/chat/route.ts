import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getOptionalUser } from "@/lib/auth";
import { guardMutation } from "@/lib/api";
import { executeChat } from "@/lib/ai/gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function safeError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  const known = new Set(["UNAUTHORIZED", "AI_VIP_REQUIRED", "AI_CREDITS_EXHAUSTED", "INVALID_REQUEST", "CONVERSATION_NOT_FOUND", "AI_REQUEST_IN_PROGRESS", "AI_SERVICE_UNAVAILABLE"]);
  if (known.has(code)) return code;
  return "AI_SERVICE_UNAVAILABLE";
}

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  const blocked = await guardMutation(request, "ai:chat", 12);
  if (blocked) return blocked;

  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED", requestId }, { status: 401 });

  const body = await request.json().catch(() => null);
  const prompt = typeof body?.prompt === "string" ? body.prompt : "";
  const conversationId = typeof body?.conversationId === "string" ? body.conversationId : "";
  const idempotencyKey = typeof body?.idempotencyKey === "string" && body.idempotencyKey.trim()
    ? body.idempotencyKey.trim()
    : requestId;
  const regenerate = body?.regenerate === true;
  const advanced = body?.advanced === true || body?.mode === "advanced";

  if (!conversationId || !prompt.trim()) return NextResponse.json({ error: "INVALID_REQUEST", requestId }, { status: 400 });

  try {
    const result = await executeChat({
      userId: user.id,
      conversationId,
      prompt,
      idempotencyKey,
      regenerate,
      advanced,
    });
    return NextResponse.json({ data: result, requestId }, { status: 200 });
  } catch (error) {
    const code = safeError(error);
    const status = code === "UNAUTHORIZED" ? 401 : code === "AI_VIP_REQUIRED" ? 403 : code === "AI_CREDITS_EXHAUSTED" ? 402 : code === "CONVERSATION_NOT_FOUND" ? 404 : code === "AI_REQUEST_IN_PROGRESS" ? 409 : code === "INVALID_REQUEST" ? 400 : 503;
    console.error(JSON.stringify({ event: "ai_gateway_failure", requestId, code }));
    return NextResponse.json({ error: code, requestId }, { status });
  }
}
