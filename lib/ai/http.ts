import { NextResponse } from "next/server";
import { rateLimitAsync } from "@/lib/security";
import { AiProviderError } from "@/lib/ai/types";

/**
 * Single place that decides which error codes the AI routes may expose and
 * which HTTP status each one gets. The UI maps these codes to messages, so the
 * set must stay in sync with components/ai/*.
 */
const STATUS_BY_CODE: Record<string, number> = {
  UNAUTHORIZED: 401,
  AI_VIP_REQUIRED: 403,
  AI_CREDITS_EXHAUSTED: 402,
  CONVERSATION_NOT_FOUND: 404,
  INVALID_REQUEST: 400,
  INVALID_IMAGE_INPUT: 400,
  AI_REQUEST_IN_PROGRESS: 409,
  AI_IDEMPOTENCY_KEY_CONFLICT: 409,
  AI_EMPTY_RESPONSE: 502,
  AI_TIMEOUT: 504,
  AI_SERVICE_UNAVAILABLE: 503,
};

/** Every error code the AI routes can return; components/ai/ai-errors.ts must have a message for each. */
export const AI_ERROR_CODES = Object.keys(STATUS_BY_CODE);

export function aiErrorCode(error: unknown): string {
  if (error instanceof AiProviderError) {
    if (error.code === "EMPTY_RESPONSE" || error.code === "INVALID_MEDIA_RESPONSE") return "AI_EMPTY_RESPONSE";
    if (error.code === "TIMEOUT") return "AI_TIMEOUT";
    return "AI_SERVICE_UNAVAILABLE";
  }
  const message = error instanceof Error ? error.message : "";
  return message in STATUS_BY_CODE ? message : "AI_SERVICE_UNAVAILABLE";
}

export function aiErrorStatus(code: string): number {
  return STATUS_BY_CODE[code] ?? 503;
}

export function aiErrorResponse(error: unknown, requestId: string, event: string) {
  const code = aiErrorCode(error);
  const providerCode = error instanceof AiProviderError ? error.code : undefined;
  console.error(JSON.stringify({ event, requestId, code, providerCode }));
  return NextResponse.json({ error: code, requestId }, { status: aiErrorStatus(code) });
}

/** Per-user limiter. The IP limiter in guardMutation can be shared by many users behind one NAT. */
export async function guardUser(userId: string, scope: string, limit: number) {
  const result = await rateLimitAsync(`${scope}:user:${userId}`, limit, 60_000);
  if (result.allowed) return null;
  return NextResponse.json(
    { error: "RATE_LIMITED", retryAfter: result.retryAfter },
    { status: 429, headers: { "Retry-After": String(result.retryAfter) } },
  );
}

export {
  MAX_IMAGE_DATA_CHARS,
  parseImageData,
  pickAspectRatio,
  pickImageSize,
  pickVideoAspectRatio,
  pickVideoResolution,
  readIdempotencyKey,
} from "@/lib/ai/validation";
