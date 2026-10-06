import { AiProviderError } from "@/lib/ai/types";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "veo-3.1-generate-preview";
const MAX_WAIT_MS = 240_000;

function key() {
  const value = process.env.GEMINI_API_KEY?.trim();
  if (!value) throw new AiProviderError({ provider: "gemini", code: "NOT_CONFIGURED" });
  return value;
}

async function call(path: string, init: RequestInit) {
  const response = await fetch(BASE_URL + path, {
    ...init,
    headers: { "Content-Type": "application/json", "x-goog-api-key": key(), ...(init.headers || {}) },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const status = response.status;
    if (status === 429) throw new AiProviderError({ provider: "gemini", code: "RATE_LIMITED", status, retryable: true, failoverable: true });
    if (status === 401 || status === 403) throw new AiProviderError({ provider: "gemini", code: "AUTH_FAILED", status, failoverable: true });
    if (status >= 500) throw new AiProviderError({ provider: "gemini", code: "UNAVAILABLE", status, retryable: true, failoverable: true });
    throw new AiProviderError({ provider: "gemini", code: "PROVIDER_ERROR", status });
  }
  return body as Record<string, unknown>;
}

export async function geminiVideo(prompt: string, image?: { base64: string; mimeType: string }) {
  const model = process.env.GEMINI_VIDEO_MODEL?.trim() || DEFAULT_MODEL;
  const instances: Record<string, unknown>[] = [{ prompt }];
  if (image) instances[0].image = { bytesBase64Encoded: image.base64, mimeType: image.mimeType };

  const operation = await call("/models/" + encodeURIComponent(model) + ":predictLongRunning", {
    method: "POST",
    body: JSON.stringify({
      instances,
      parameters: {
        aspectRatio: process.env.GEMINI_VIDEO_ASPECT_RATIO === "16:9" ? "16:9" : "9:16",
        resolution: process.env.GEMINI_VIDEO_RESOLUTION === "1080p" ? "1080p" : "720p",
      },
    }),
  });

  const name = typeof operation.name === "string" ? operation.name : "";
  if (!name) throw new AiProviderError({ provider: "gemini", code: "INVALID_VIDEO_OPERATION", failoverable: true });

  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    const status = await call("/" + name.replace(/^\//, ""), { method: "GET" });
    if (status.done === true) {
      const error = status.error;
      if (error) throw new AiProviderError({ provider: "gemini", code: "VIDEO_GENERATION_FAILED", failoverable: true });
      const response = status.response;
      const generated = response && typeof response === "object"
        ? (response as { generateVideoResponse?: { generatedSamples?: Array<{ video?: { uri?: string; mimeType?: string } }> } }).generateVideoResponse?.generatedSamples
        : undefined;
      const uri = generated?.[0]?.video?.uri;
      if (!uri) throw new AiProviderError({ provider: "gemini", code: "VIDEO_NOT_RETURNED", failoverable: true });
      const download = await fetch(uri, { headers: { "x-goog-api-key": key() } });
      if (!download.ok) throw new AiProviderError({ provider: "gemini", code: "VIDEO_DOWNLOAD_FAILED", status: download.status, failoverable: true });
      return { model, operationName: name, buffer: Buffer.from(await download.arrayBuffer()), mimeType: generated?.[0]?.video?.mimeType || "video/mp4" };
    }
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  throw new AiProviderError({ provider: "gemini", code: "TIMEOUT", retryable: true, failoverable: true });
}
