import { db } from "@/lib/prisma";
import { geminiChat, geminiHealth } from "@/lib/ai/gemini";
import { manusChat } from "@/lib/ai/manus";
import { AiProviderError, type AiChatAttempt, type AiChatInput, type AiChatResult, type AiProvider, type AiProviderHealth } from "@/lib/ai/types";

const COOLDOWN_MS = 60_000;
// The chat route has maxDuration = 300s. The whole provider chain (including
// failover) must give up before that so the credit refund can still run.
const CHAT_DEADLINE_MS = 240_000;
const MIN_ATTEMPT_MS = 15_000;

async function recentlyFailed(provider: AiProvider) {
  const since = new Date(Date.now() - COOLDOWN_MS);
  const row = await db.aiUsageLedger.findFirst({
    // Image/video failures share provider "gemini" in the ledger; only chat
    // failures may push chat traffic over to the fallback provider.
    where: { provider, status: "FAILED", operation: { in: ["CHAT", "ADVANCED_CHAT"] }, createdAt: { gte: since } },
    select: { id: true },
    orderBy: { createdAt: "desc" },
  });
  return Boolean(row);
}

function isFailoverable(error: unknown) {
  return error instanceof AiProviderError && error.failoverable;
}

async function call(provider: AiProvider, input: AiChatInput): Promise<AiChatResult> {
  return provider === "gemini" ? geminiChat(input) : manusChat(input);
}

export async function runChatWithFailover(input: AiChatInput) {
  const geminiCooling = await recentlyFailed("gemini");
  const providers: AiProvider[] = geminiCooling ? ["manus", "gemini"] : ["gemini", "manus"];
  const attempts: AiChatAttempt[] = [];
  const deadline = Date.now() + CHAT_DEADLINE_MS;

  for (const provider of providers) {
    const remaining = deadline - Date.now();
    if (attempts.length > 0 && remaining < MIN_ATTEMPT_MS) break;
    if (provider === "gemini" && !process.env.GEMINI_API_KEY?.trim()) continue;
    if (provider === "manus" && !process.env.MANUS_API_KEY?.trim()) continue;
    try {
      const providerInput = provider === "gemini" && input.previousInteractionId
        ? { ...input, history: [] }
        : input;
      const attemptSignal = AbortSignal.timeout(Math.max(remaining, 1_000));
      const signal = providerInput.signal ? AbortSignal.any([providerInput.signal, attemptSignal]) : attemptSignal;
      const result = await call(provider, { ...providerInput, signal });
      // A provider that answers 200 with an empty / non-string answer is a failure, not a reply.
      if (!result || typeof result.answer !== "string" || !result.answer.trim()) {
        throw new AiProviderError({ provider, code: "EMPTY_RESPONSE", failoverable: true });
      }
      attempts.push({ provider, result });
      return { result, attempts };
    } catch (error) {
      const timedOut = Date.now() >= deadline;
      const normalized = timedOut
        ? new AiProviderError({ provider, code: "TIMEOUT", retryable: true })
        : error instanceof AiProviderError
          ? error
          : new AiProviderError({ provider, code: "UNAVAILABLE", retryable: true, failoverable: true });
      attempts.push({ provider, error: normalized });
      if (!isFailoverable(normalized)) break;
    }
  }

  const last = attempts.at(-1)?.error;
  const failure = last
    ? new AiProviderError({ provider: last.provider, code: last.code, status: last.status, retryable: last.retryable, failoverable: last.failoverable })
    : new AiProviderError({ provider: "gemini", code: "NO_PROVIDER_AVAILABLE" });
  failure.attempts = attempts;
  throw failure;
}

export async function getProviderHealth(): Promise<Record<AiProvider, { status: AiProviderHealth; latencyMs: number | null }>> {
  const gemini = process.env.GEMINI_API_KEY?.trim()
    ? await geminiHealth()
    : "OFFLINE";
  const manus = process.env.MANUS_API_KEY?.trim()
    ? (await recentlyFailed("manus") ? "DEGRADED" : "ACTIVE")
    : "OFFLINE";
  return {
    gemini: { status: gemini, latencyMs: null },
    manus: { status: manus, latencyMs: null },
  };
}
