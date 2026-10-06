import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getOptionalUser } from "@/lib/auth";
import { guardMutation } from "@/lib/api";
import { db } from "@/lib/prisma";
import { getVipAccess } from "@/lib/vip";
import { consumeAiCredit, refundAiCredit } from "@/lib/ai-media/credits";
import { getAiCost } from "@/lib/ai-media/costs";
import { createChatStream } from "@/lib/gamevortex-ai/runtime";
import {
  finishAiUsage,
  startAiUsage,
  updateAiUsage,
} from "@/lib/gamevortex-ai/usage-ledger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function errorResponse(code: string, status: number, requestId: string) {
  return NextResponse.json(
    { error: code, requestId },
    {
      status,
      headers: { "X-Request-Id": requestId },
    }
  );
}

function classifyError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const prismaCode =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code || "")
      : "";

  if (/^P\d{4}$/.test(prismaCode)) {
    return "DATABASE_UNAVAILABLE";
  }

  const known = new Set([
    "UNAUTHORIZED",
    "AI_VIP_REQUIRED",
    "AI_CREDITS_EXHAUSTED",
    "INVALID_REQUEST",
    "CONVERSATION_NOT_FOUND",
    "REGENERATION_NOT_AVAILABLE",
    "SENSITIVE_SITE_REQUEST_BLOCKED",
    "RUNTIME_NOT_CONFIGURED",
    "RUNTIME_TOKEN_NOT_CONFIGURED",
    "RUNTIME_CONFIGURATION_INVALID",
    "RUNTIME_AUTH_FAILED",
    "RUNTIME_ENDPOINT_INVALID",
    "RUNTIME_UNREACHABLE",
    "RUNTIME_TIMEOUT",
    "RUNTIME_REQUEST_CANCELLED",
    "RUNTIME_HTTP_ERROR",
    "RUNTIME_INVALID_RESPONSE",
    "RUNTIME_STREAM_FAILED",
    "RUNTIME_EMPTY_RESPONSE",
    "MANUS_TASK_FAILED",
    "MANUS_TASK_WAITING_FOR_INPUT",
    "MANUS_EMPTY_RESPONSE",
    "MANUS_TIMEOUT",
    "MANUS_AUTH_FAILED",
    "MANUS_RATE_LIMITED",
    "MANUS_UNAVAILABLE",
    "MANUS_PROVIDER_ERROR",
    "MANUS_INVALID_RESPONSE",
    "MANUS_INVALID_TASK_RESPONSE",
    "GEMINI_NOT_CONFIGURED",
    "GEMINI_CONFIGURATION_INVALID",
    "DATABASE_UNAVAILABLE",
  ]);

  return known.has(message) ? message : "AI_SERVICE_UNAVAILABLE";
}

export async function POST(request: NextRequest) {
  const requestId = randomUUID();

  const blocked = await guardMutation(request, "gamevortex-ai:chat", 12);
  if (blocked) return blocked;

  const user = await getOptionalUser();
  if (!user) {
    return errorResponse("UNAUTHORIZED", 401, requestId);
  }

  const body = await request.json().catch(() => null);
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  const conversationId = typeof body?.conversationId === "string" ? body.conversationId : "";
  const regenerate = body?.regenerate === true;
  const idempotencyKey = typeof body?.idempotencyKey === "string" && body.idempotencyKey.trim()
    ? body.idempotencyKey.trim()
    : `chat:${conversationId}:${randomUUID()}`;
  const creditAmount = body?.advanced === true || body?.mode === "advanced"
    ? getAiCost("ADVANCED_CHAT_COST")
    : getAiCost("CHAT_COST");

  if (
    !prompt ||
    prompt.length > 6000 ||
    !conversationId ||
    (body?.regenerate !== undefined && typeof body.regenerate !== "boolean")
  ) {
    return errorResponse("INVALID_REQUEST", 400, requestId);
  }

  const vip = await getVipAccess(user.id);
  if (!vip.isVip) return errorResponse("AI_VIP_REQUIRED", 403, requestId);

  try {
    await consumeAiCredit(user.id, "CHAT", idempotencyKey, creditAmount);
  } catch (error) {
    const code = error instanceof Error ? error.message : "AI_CREDITS_EXHAUSTED";
    return errorResponse(code === "AI_CREDITS_EXHAUSTED" ? code : "AI_CREDITS_EXHAUSTED", 402, requestId);
  }

  let usageId: string | undefined;

  try {
    const usage = await startAiUsage({
      userId: user.id,
      provider: "manus",
      operation: body?.advanced === true || body?.mode === "advanced" ? "ADVANCED_CHAT" : "CHAT",
      idempotencyKey,
      gvcReserved: creditAmount,
      requestId,
    });
    usageId = usage.usage.id;

    const { response, replaceMessageId, requestId: manusRequestId, taskId } =
      await createChatStream(
      user.id,
      conversationId,
      prompt,
      request.signal,
      regenerate
    );

    await updateAiUsage(usageId, user.id, {
      status: "PROCESSING",
      requestId: manusRequestId || requestId,
      taskId,
      startedAt: new Date(),
    });

    if (!response.body) {
      throw new Error("RUNTIME_INVALID_RESPONSE");
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    let buffer = "";
    let answer = "";
    let upstreamReader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = response.body?.getReader();
        if (!reader) {
          controller.error(new Error("RUNTIME_INVALID_RESPONSE"));
          return;
        }

        upstreamReader = reader;

        const acceptLine = (rawLine: string) => {
          let line = rawLine.trim();
          if (!line) return;

          // معالجة صيغة Server-Sent Events (SSE) إن وجدت
          if (line.startsWith("data:")) {
            line = line.slice(5).trim();
          }
          if (line === "[DONE]") return;

          let item: {
            message?: { content?: string };
            done?: boolean;
            error?: unknown;
          };

          try {
            item = JSON.parse(line) as typeof item;
          } catch {
            // في حال كان النص المرسل عبارة عن مجرد نص خام وليس JSON
            item = { message: { content: line } };
          }

          if (item.error) {
            throw new Error("RUNTIME_STREAM_FAILED");
          }

          const piece = typeof item.message?.content === "string" ? item.message.content : "";

          answer += piece;

          if (piece) {
            controller.enqueue(encoder.encode(piece));
          }
        };

        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              acceptLine(line);
            }
          }

          buffer += decoder.decode();
          if (buffer.trim()) {
            acceptLine(buffer);
          }

          if (!answer.trim()) {
            throw new Error("RUNTIME_EMPTY_RESPONSE");
          }

          // حفظ البيانات في Prisma بعد اكتمال البث
          await db.$transaction(async (tx) => {
            if (replaceMessageId) {
              const result = await tx.gameVortexAiMessage.updateMany({
                where: {
                  id: replaceMessageId,
                  conversationId,
                  role: "assistant",
                },
                data: { content: answer },
              });

              if (!result.count) {
                throw new Error("REGENERATION_NOT_AVAILABLE");
              }
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
              : await tx.gameVortexAiMessage.count({
                  where: { conversationId },
                });

            await tx.gameVortexAiConversation.update({
              where: { id: conversationId },
              data: {
                updatedAt: new Date(),
                ...(!replaceMessageId && messageCount === 2
                  ? { title: prompt.slice(0, 90) }
                  : {}),
              },
            });
          });

          await finishAiUsage(usageId!, user.id, {
            status: "COMPLETED",
            gvcUsed: creditAmount,
            gvcRefunded: 0,
          });

          controller.close();
        } catch (error) {
          const code = classifyError(error);

          const stopped = code === "RUNTIME_REQUEST_CANCELLED";
          await refundAiCredit(user.id, "CHAT", idempotencyKey, creditAmount).catch(() => undefined);
          await finishAiUsage(usageId!, user.id, {
            status: stopped ? "STOPPED" : "FAILED",
            gvcUsed: 0,
            gvcRefunded: creditAmount,
            errorCode: code,
          }).catch(() => undefined);

          console.error(
            JSON.stringify({
              event: "gamevortex_ai_stream_failed",
              code,
              requestId,
            })
          );

          try {
            await reader.cancel();
          } catch {
            // تجاهل الخطأ في حال إغلاق الـ Stream
          }

          controller.error(new Error(code));
        } finally {
          try {
            reader.releaseLock();
          } catch {
            // تجاهل الخطأ
          }
          upstreamReader = undefined;
        }
      },

      async cancel() {
        try {
          await upstreamReader?.cancel();
        } catch {
          // العميل ألغى الاتصال
        }
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
    await refundAiCredit(user.id, "CHAT", idempotencyKey, creditAmount).catch(() => undefined);
    if (usageId) {
      await finishAiUsage(usageId, user.id, {
        status: safeCode === "RUNTIME_REQUEST_CANCELLED" ? "STOPPED" : "FAILED",
        gvcUsed: 0,
        gvcRefunded: creditAmount,
        errorCode: safeCode,
      }).catch(() => undefined);
    }

    if (safeCode !== "RUNTIME_REQUEST_CANCELLED") {
      console.error(
        JSON.stringify({
          event: "gamevortex_ai_request_failed",
          code: safeCode,
          requestId,
        })
      );
    }

    const statusByCode: Record<string, number> = {
      UNAUTHORIZED: 401,
      INVALID_REQUEST: 400,
      SENSITIVE_SITE_REQUEST_BLOCKED: 403,
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
      MANUS_TASK_FAILED: 502,
      MANUS_TASK_WAITING_FOR_INPUT: 409,
      MANUS_EMPTY_RESPONSE: 502,
      MANUS_TIMEOUT: 504,
      MANUS_AUTH_FAILED: 502,
      MANUS_RATE_LIMITED: 429,
      MANUS_UNAVAILABLE: 502,
      MANUS_PROVIDER_ERROR: 502,
      MANUS_INVALID_RESPONSE: 502,
      MANUS_INVALID_TASK_RESPONSE: 502,
      GEMINI_NOT_CONFIGURED: 503,
      GEMINI_CONFIGURATION_INVALID: 503,
      DATABASE_UNAVAILABLE: 503,
    };

    return errorResponse(safeCode, statusByCode[safeCode] || 503, requestId);
  }
}
