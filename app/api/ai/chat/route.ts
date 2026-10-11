import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getOptionalUser } from "@/lib/auth";
import { guardMutation } from "@/lib/api";
import { executeChat } from "@/lib/ai/gateway";
import { aiErrorResponse, guardUser, readIdempotencyKey } from "@/lib/ai/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/ai/chat
 * Request : { prompt, conversationId, idempotencyKey?, regenerate?, advanced? }
 * Success : 200 { data: { answer, provider, model, requestId, latencyMs }, requestId }
 * Failure : { error: <code>, requestId } with the status from lib/ai/http.ts
 * components/ai/AiHubClient.tsx reads `data.answer` and `error`.
 */
export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  const blocked = await guardMutation(request, "ai:chat", 30);
  if (blocked) return blocked;

  // A database failure while reading the session must answer JSON (503), not throw out of the handler.
  let user: Awaited<ReturnType<typeof getOptionalUser>>;
  try {
    user = await getOptionalUser();
  } catch (error) {
    return aiErrorResponse(error, requestId, "ai_auth_failure");
  }
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED", requestId }, { status: 401 });

  const limited = await guardUser(user.id, "ai:chat", 12);
  if (limited) return limited;

  const body = await request.json().catch(() => null);
  const prompt = typeof body?.prompt === "string" ? body.prompt : "";
  const conversationId = typeof body?.conversationId === "string" ? body.conversationId : "";
  const idempotencyKey = readIdempotencyKey(body?.idempotencyKey, requestId);
  const regenerate = body?.regenerate === true;
  const advanced = body?.advanced === true || body?.mode === "advanced";

  if (!conversationId || !prompt.trim() || !idempotencyKey) {
    return NextResponse.json({ error: "INVALID_REQUEST", requestId }, { status: 400 });
  }

  try {
    const result = await executeChat({ userId: user.id, conversationId, prompt, idempotencyKey, regenerate, advanced });
    if (!result || typeof result.answer !== "string" || !result.answer.trim()) {
      throw new Error("AI_SERVICE_UNAVAILABLE");
    }
    return NextResponse.json({ data: result, requestId }, { status: 200, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return aiErrorResponse(error, requestId, "ai_gateway_failure");
  }
}
