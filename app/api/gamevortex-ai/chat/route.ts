import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getOptionalUser } from "@/lib/auth";
import { guardMutation } from "@/lib/api";
import { db } from "@/lib/prisma";
import { createChatStream } from "@/lib/gamevortex-ai/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function errorResponse(code: string, status: number, requestId: string) {
  return NextResponse.json({ error: code, requestId }, { status, headers: { "X-Request-Id": requestId } });
}

function classifyError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/^P\d{4}$/.test(String((error as { code?: unknown })?.code || ""))) return "DATABASE_UNAVAILABLE";
  const known = new Set([
    "CONVERSATION_NOT_FOUND", "REGENERATION_NOT_AVAILABLE", "RUNTIME_NOT_CONFIGURED",
    "RUNTIME_TOKEN_NOT_CONFIGURED", "RUNTIME_CONFIGURATION_INVALID", "RUNTIME_AUTH_FAILED",
    "RUNTIME_ENDPOINT_INVALID", "RUNTIME_UNREACHABLE", "RUNTIME_TIMEOUT",
    "RUNTIME_REQUEST_CANCELLED", "RUNTIME_HTTP_ERROR", "RUNTIME_INVALID_RESPONSE",
    "RUNTIME_STREAM_FAILED", "RUNTIME_EMPTY_RESPONSE", "DATABASE_UNAVAILABLE",
  ]);
  return known.has(message) ? message : "AI_SERVICE_UNAVAILABLE";
}

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  const blocked = await guardMutation(request, "gamevortex-ai:chat", 12);
  if (blocked) return blocked;

  const user = await getOptionalUser();
  if (!user) return errorResponse("UNAUTHORIZED", 401, requestId);

  const body = await request.json().catch(() => null);
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  const conversationId = typeof body?.conversationId === "string" ? body.conversationId : "";
  const regenerate = body?.regenerate === true;
  if (!prompt || prompt.length > 6000 || !conversationId || (body?.regenerate !== undefined && typeof body.regenerate !== "boolean")) {
    return errorResponse("INVALID_REQUEST", 400, requestId);
  }

  try {
    const { response, replaceMessageId } = await createChatStream(user.id, conversationId, prompt, request.signal, regenerate);
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let buffer = "";
    let answer = "";
    let upstreamReader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        upstreamReader = response.body!.getReader();
        const acceptLine = (line: string) => {
          if (!line.trim()) return;
          let item: { message?: { content?: string }; done?: boolean; error?: unknown };
          try {
            item = JSON.parse(line) as typeof item;
          } catch {
            throw new Error("RUNTIME_INVALID_RESPONSE");
          }
          if (item.error) throw new Error("RUNTIME_STREAM_FAILED");
          const piece = typeof item.message?.content === "string" ? item.message.content : "";
          answer += piece;
          if (piece) controller.enqueue(encoder.encode(piece));
        };

        try {
          while (true) {
            const { value, done } = await upstreamReader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) acceptLine(line);
          }
          buffer += decoder.decode();
          if (buffer.trim()) acceptLine(buffer);
          if (!answer.trim()) throw new Error("RUNTIME_EMPTY_RESPONSE");

          await db.$transaction(async (tx) => {
            if (replaceMessageId) {
              const result = await tx.gameVortexAiMessage.updateMany({
                where: { id: replaceMessageId, conversationId, role: "assistant" },
                data: { content: answer },
              });
              if (!result.count) throw new Error("REGENERATION_NOT_AVAILABLE");
            } else {
              await tx.gameVortexAiMessage.createMany({
                data: [
                  { conversationId, role: "user", content: prompt },
                  { conversationId, role: "assistant", content: answer },
                ],
              });
            }

            const messageCount = replaceMessageId
              ? undefined
              : await tx.gameVortexAiMessage.count({ where: { conversationId } });
            await tx.gameVortexAiConversation.update({
              where: { id: conversationId },
              data: {
                updatedAt: new Date(),
                ...(!replaceMessageId && messageCount === 2 ? { title: prompt.slice(0, 90) } : {}),
              },
            });
          });
          controller.close();
        } catch (error) {
          const code = classifyError(error);
          console.error(JSON.stringify({ event: "gamevortex_ai_stream_failed", code, requestId }));
          try { await upstreamReader?.cancel(); } catch { /* Upstream may already be closed. */ }
          controller.error(new Error(code));
        } finally {
          upstreamReader?.releaseLock();
        }
      },
      async cancel() {
        try { await upstreamReader?.cancel(); } catch { /* Client already disconnected. */ }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        "X-Content-Type-Options": "nosniff",
        "X-Request-Id": requestId,
      },
    });
  } catch (error) {
    const safeCode = classifyError(error);
    if (safeCode !== "RUNTIME_REQUEST_CANCELLED") console.error(JSON.stringify({ event: "gamevortex_ai_request_failed", code: safeCode, requestId }));
    const statusByCode: Record<string, number> = {
      CONVERSATION_NOT_FOUND: 404,
      REGENERATION_NOT_AVAILABLE: 409,
      RUNTIME_NOT_CONFIGURED: 503,
      RUNTIME_TOKEN_NOT_CONFIGURED: 503,
      RUNTIME_CONFIGURATION_INVALID: 503,
      RUNTIME_AUTH_FAILED: 502,
      RUNTIME_ENDPOINT_INVALID: 502,
      RUNTIME_UNREACHABLE: 502,
      RUNTIME_TIMEOUT: 504,
      RUNTIME_REQUEST_CANCELLED: 499,
      RUNTIME_HTTP_ERROR: 502,
      RUNTIME_INVALID_RESPONSE: 502,
      RUNTIME_STREAM_FAILED: 502,
      RUNTIME_EMPTY_RESPONSE: 502,
      DATABASE_UNAVAILABLE: 503,
    };
    return errorResponse(safeCode, statusByCode[safeCode] || 503, requestId);
  }
}
