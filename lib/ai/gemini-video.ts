import { AiProviderError } from "@/lib/ai/types";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-omni-1.1-flash";
const TIMEOUT_MS = 240_000;

function key() {
  const value = process.env.GEMINI_API_KEY?.trim();
  if (!value) throw new AiProviderError({ provider: "gemini", code: "NOT_CONFIGURED" });
  return value;
}

async function call(body: unknown) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(BASE_URL + "/interactions", {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", "x-goog-api-key": key() },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 429) throw new AiProviderError({ provider: "gemini", code: "RATE_LIMITED", status: response.status, retryable: true, failoverable: true });
      if (response.status === 401 || response.status === 403) throw new AiProviderError({ provider: "gemini", code: "AUTH_FAILED", status: response.status, failoverable: true });
      if (response.status >= 500) throw new AiProviderError({ provider: "gemini", code: "UNAVAILABLE", status: response.status, retryable: true, failoverable: true });
      throw new AiProviderError({ provider: "gemini", code: "PROVIDER_ERROR", status: response.status });
    }
    return payload as Record<string, unknown>;
  } catch (error) {
    if (error instanceof AiProviderError) throw error;
    if (controller.signal.aborted) throw new AiProviderError({ provider: "gemini", code: "TIMEOUT", retryable: true, failoverable: true });
    throw new AiProviderError({ provider: "gemini", code: "UNAVAILABLE", retryable: true, failoverable: true });
  } finally {
    clearTimeout(timer);
  }
}

export async function geminiVideo(prompt: string, image?: { base64: string; mimeType: string }) {
  const model = process.env.GEMINI_VIDEO_MODEL?.trim() || DEFAULT_MODEL;
  const input = image
    ? [{ type: "image", data: image.base64, mime_type: image.mimeType }, { type: "text", text: prompt }]
    : prompt;
  const resolution = process.env.GEMINI_VIDEO_RESOLUTION === "1080p" ? "1080p" : process.env.GEMINI_VIDEO_RESOLUTION === "4k" ? "4k" : "720p";
  const aspectRatio = process.env.GEMINI_VIDEO_ASPECT_RATIO === "16:9" ? "16:9" : "9:16";
  const started = Date.now();
  const result = await call({
    model,
    input,
    response_format: { type: "video", aspect_ratio: aspectRatio, resolution },
  });
  const output = result.output_video;
  const data = output && typeof output === "object" ? (output as { data?: unknown }).data : undefined;
  if (typeof data !== "string" || !data) throw new AiProviderError({ provider: "gemini", code: "VIDEO_NOT_RETURNED", failoverable: true });
  return {
    model,
    operationName: typeof result.id === "string" ? result.id : undefined,
    buffer: Buffer.from(data, "base64"),
    mimeType: "video/mp4",
    latencyMs: Date.now() - started,
  };
}
