import { randomUUID } from "node:crypto";
import { AiProviderError, type AiChatInput, type AiChatResult } from "@/lib/ai/types";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_CHAT_MODEL = "gemini-3.6-flash";
const TIMEOUT_MS = 30_000;

function getKey() {
  const value = process.env.GEMINI_API_KEY?.trim();
  if (!value) throw new AiProviderError({ provider: "gemini", code: "NOT_CONFIGURED" });
  if (value.length > 4096 || /[\r\n]/.test(value)) throw new AiProviderError({ provider: "gemini", code: "CONFIGURATION_INVALID" });
  return value;
}

function getModel(name: string, fallback: string) {
  return process.env[name]?.trim() || fallback;
}

function classify(status: number, body: unknown): AiProviderError {
  const error = body && typeof body === "object" && "error" in body ? (body as { error?: { status?: unknown } }).error : undefined;
  const statusText = typeof error?.status === "string" ? error.status.toLowerCase() : "";
  if (status === 401 || status === 403) return new AiProviderError({ provider: "gemini", code: "AUTH_FAILED", status, failoverable: true });
  if (status === 402) return new AiProviderError({ provider: "gemini", code: "BILLING_REQUIRED", status, failoverable: true });
  if (status === 429 || statusText.includes("quota") || statusText.includes("resource_exhausted") || statusText.includes("rate_limit")) {
    return new AiProviderError({ provider: "gemini", code: statusText.includes("quota") ? "QUOTA_EXCEEDED" : "RATE_LIMITED", status, retryable: true, failoverable: true });
  }
  if (status === 408 || status === 504) return new AiProviderError({ provider: "gemini", code: "TIMEOUT", status, retryable: true, failoverable: true });
  if (status >= 500) return new AiProviderError({ provider: "gemini", code: "UNAVAILABLE", status, retryable: true, failoverable: true });
  return new AiProviderError({ provider: "gemini", code: "PROVIDER_ERROR", status });
}

async function request(body: unknown, signal?: AbortSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(BASE_URL + "/interactions", {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", "x-goog-api-key": getKey() },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw classify(response.status, payload);
    return { payload, requestId: response.headers.get("x-request-id") || undefined };
  } catch (error) {
    if (error instanceof AiProviderError) throw error;
    if (controller.signal.aborted) throw new AiProviderError({ provider: "gemini", code: "TIMEOUT", retryable: true, failoverable: true });
    throw new AiProviderError({ provider: "gemini", code: "UNAVAILABLE", retryable: true, failoverable: true });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

function modelOutputBlocks(payload: unknown) {
  if (!payload || typeof payload !== "object") return [];
  const steps = (payload as { steps?: unknown }).steps;
  if (!Array.isArray(steps)) return [];
  return steps
    .filter(step => step && typeof step === "object" && (step as { type?: unknown }).type === "model_output")
    .flatMap(step => {
      const content = (step as { content?: unknown }).content;
      return Array.isArray(content) ? content : [];
    })
    .filter(block => block && typeof block === "object") as Array<Record<string, unknown>>;
}

function textFromPayload(payload: unknown) {
  return modelOutputBlocks(payload)
    .filter(block => block.type === "text" && typeof block.text === "string")
    .map(block => String(block.text))
    .join("")
    .trim();
}

export async function geminiChat(input: AiChatInput): Promise<AiChatResult> {
  const started = Date.now();
  const model = getModel("GEMINI_CHAT_MODEL", DEFAULT_CHAT_MODEL);
  const history = (input.history || []).map(message => (message.role === "assistant" ? "GameVortex AI: " : "User: ") + message.content).join("\n\n");
  const result = await request({
    model,
    input: [history, "User: " + input.prompt].filter(Boolean).join("\n\n"),
    system_instruction: input.systemInstruction || undefined,
    generation_config: { max_output_tokens: Number(process.env.GEMINI_MAX_OUTPUT_TOKENS || 2048), temperature: 0.7, thinking_level: process.env.GEMINI_THINKING_LEVEL?.trim() || "low" },
    ...(input.previousInteractionId ? { previous_interaction_id: input.previousInteractionId } : {}),
  }, input.signal);
  const answer = textFromPayload(result.payload);
  if (!answer) throw new AiProviderError({ provider: "gemini", code: "EMPTY_RESPONSE", failoverable: true });
  const interactionId = result.payload && typeof result.payload === "object" && typeof (result.payload as { id?: unknown }).id === "string"
    ? String((result.payload as { id: string }).id)
    : undefined;
  return { provider: "gemini", model, answer, providerRequestId: result.requestId || randomUUID(), providerInteractionId: interactionId, latencyMs: Date.now() - started };
}

export async function geminiHealth() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const response = await fetch(BASE_URL + "/models/" + encodeURIComponent(getModel("GEMINI_CHAT_MODEL", DEFAULT_CHAT_MODEL)), {
      method: "GET",
      signal: controller.signal,
      headers: { "x-goog-api-key": getKey() },
    });
    clearTimeout(timer);
    if (response.ok) return "ACTIVE" as const;
    if (response.status === 429) return "RATE_LIMITED" as const;
    if (response.status === 402) return "QUOTA_EXCEEDED" as const;
    return "OFFLINE" as const;
  } catch {
    return "OFFLINE" as const;
  }
}
