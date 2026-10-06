import { db } from "@/lib/prisma";
import { geminiChat, geminiHealth } from "@/lib/ai/gemini";
import { manusChat } from "@/lib/ai/manus";
import { AiProviderError, type AiChatInput, type AiChatResult, type AiProvider, type AiProviderHealth } from "@/lib/ai/types";

const COOLDOWN_MS = 60_000;

async function recentlyFailed(provider: AiProvider) {
  const since = new Date(Date.now() - COOLDOWN_MS);
  const row = await db.aiUsageLedger.findFirst({
    where: { provider, status: "FAILED", createdAt: { gte: since } },
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
  const attempts: Array<{ provider: AiProvider; error?: AiProviderError; result?: AiChatResult }> = [];

  for (const provider of providers) {
    if (provider === "gemini" && !process.env.GEMINI_API_KEY?.trim()) continue;
    if (provider === "manus" && !process.env.MANUS_API_KEY?.trim()) continue;
    try {
      const result = await call(provider, input);
      attempts.push({ provider, result });
      return { result, attempts };
    } catch (error) {
      const normalized = error instanceof AiProviderError
        ? error
        : new AiProviderError({ provider, code: "UNAVAILABLE", retryable: true, failoverable: true });
      attempts.push({ provider, error: normalized });
      if (!isFailoverable(normalized)) break;
    }
  }

  throw attempts.at(-1)?.error || new AiProviderError({ provider: "gemini", code: "NO_PROVIDER_AVAILABLE" });
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
