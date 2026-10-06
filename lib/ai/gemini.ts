import { randomUUID } from "node:crypto";
import { AiProviderError, type AiChatInput, type AiChatResult, type AiImageInput, type AiImageResult } from "@/lib/ai/types";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_CHAT_MODEL = "gemini-3.6-flash";
const DEFAULT_IMAGE_MODEL = "gemini-3.1-flash-image";
const TIMEOUT_MS = 90_000;

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

async function request(path: string, body: unknown, signal?: AbortSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(BASE_URL + path, {
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

function textFromPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const candidates = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates)) return "";
  const output: string[] = [];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const content = (candidate as { content?: unknown }).content;
    if (!content || typeof content !== "object") continue;
    const parts = (content as { parts?: unknown }).parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") output.push((part as { text: string }).text);
    }
  }
  return output.join("").trim();
}

function imageFromPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const candidates = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates)) return null;
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const content = (candidate as { content?: unknown }).content;
    if (!content || typeof content !== "object") continue;
    const parts = (content as { parts?: unknown }).parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      const data = part && typeof part === "object" ? (part as { inlineData?: { data?: unknown; mimeType?: unknown } }).inlineData : undefined;
      if (typeof data?.data === "string" && data.data) {
        return { base64: data.data, mimeType: typeof data.mimeType === "string" && data.mimeType.startsWith("image/") ? data.mimeType : "image/png" };
      }
    }
  }
  return null;
}

export async function geminiChat(input: AiChatInput): Promise<AiChatResult> {
  const started = Date.now();
  const model = getModel("GEMINI_CHAT_MODEL", DEFAULT_CHAT_MODEL);
  const contents = (input.history || []).map(message => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }],
  }));
  contents.push({ role: "user", parts: [{ text: input.prompt }] });
  const result = await request("/models/" + encodeURIComponent(model) + ":generateContent", {
    systemInstruction: input.systemInstruction ? { parts: [{ text: input.systemInstruction }] } : undefined,
    contents,
    generationConfig: { maxOutputTokens: Number(process.env.GEMINI_MAX_OUTPUT_TOKENS || 2048), temperature: 0.7 },
  }, input.signal);
  const answer = textFromPayload(result.payload);
  if (!answer) throw new AiProviderError({ provider: "gemini", code: "EMPTY_RESPONSE", failoverable: true });
  return { provider: "gemini", model, answer, providerRequestId: result.requestId || randomUUID(), latencyMs: Date.now() - started };
}

export async function geminiImage(input: AiImageInput): Promise<AiImageResult> {
  const started = Date.now();
  const model = getModel("GEMINI_IMAGE_MODEL", DEFAULT_IMAGE_MODEL);
  const parts = [];
  if (input.inputImage) parts.push({ inlineData: { mimeType: input.inputImage.mimeType, data: input.inputImage.base64 } });
  parts.push({ text: input.inputImage ? "Edit the provided image according to this instruction: " + input.prompt : input.prompt });
  const result = await request("/models/" + encodeURIComponent(model) + ":generateContent", {
    contents: [{ parts }],
    response_format: { type: "image", aspect_ratio: input.aspectRatio || "1:1", image_size: input.imageSize || (process.env.GEMINI_IMAGE_SIZE as "512" | "1K" | "2K" | "4K" | undefined) || "1K" },
  }, input.signal);
  const image = imageFromPayload(result.payload);
  if (!image) throw new AiProviderError({ provider: "gemini", code: "IMAGE_NOT_RETURNED", failoverable: true });
  return { provider: "gemini", model, ...image, providerRequestId: result.requestId || randomUUID(), latencyMs: Date.now() - started };
}

export async function geminiHealth() {
  try {
    await geminiChat({ prompt: "Return only OK.", systemInstruction: "Health check." });
    return "ACTIVE" as const;
  } catch (error) {
    if (error instanceof AiProviderError && error.code === "RATE_LIMITED") return "RATE_LIMITED" as const;
    if (error instanceof AiProviderError && (error.code === "QUOTA_EXCEEDED" || error.code === "BILLING_REQUIRED")) return "QUOTA_EXCEEDED" as const;
    return "OFFLINE" as const;
  }
}
