import { AiProviderError } from "@/lib/ai/types";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const REQUEST_TIMEOUT_MS = 300_000;

function getKey() {
  const value = process.env.GEMINI_API_KEY?.trim();
  if (!value) throw new AiProviderError({ provider: "gemini", code: "NOT_CONFIGURED" });
  if (value.length > 4096 || /[\\r\\n]/.test(value)) {
    throw new AiProviderError({ provider: "gemini", code: "CONFIGURATION_INVALID" });
  }
  return value;
}

async function request(path: string, init: RequestInit, signal?: AbortSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });

  try {
    const response = await fetch(BASE_URL + path, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-goog-api-key": getKey(),
        ...(init.headers || {}),
      },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const status = response.status;
      const code = status === 401 || status === 403
        ? "AUTH_FAILED"
        : status === 429
          ? "RATE_LIMITED"
          : status >= 500
            ? "UNAVAILABLE"
            : "PROVIDER_ERROR";
      throw new AiProviderError({ provider: "gemini", code, status, retryable: status === 429 || status >= 500, failoverable: status === 401 || status === 403 || status === 429 || status >= 500 });
    }
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof AiProviderError) throw error;
    if (controller.signal.aborted) {
      throw new AiProviderError({ provider: "gemini", code: "TIMEOUT", retryable: true, failoverable: true });
    }
    throw new AiProviderError({ provider: "gemini", code: "UNAVAILABLE", retryable: true, failoverable: true });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

function modelOutput(payload: unknown, type: "image" | "video") {
  if (!payload || typeof payload !== "object") return null;
  const steps = (payload as { steps?: unknown }).steps;
  if (!Array.isArray(steps)) return null;

  for (const step of steps) {
    if (!step || typeof step !== "object" || (step as { type?: unknown }).type !== "model_output") continue;
    const content = (step as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || typeof block !== "object" || (block as { type?: unknown }).type !== type) continue;
      return block as Record<string, unknown>;
    }
  }
  return null;
}

function inputParts(prompt: string, imageData?: string) {
  if (!imageData) return prompt;
  const match = imageData.match(/^data:(image\\/(?:png|jpeg|webp));base64,(.+)$/);
  if (!match) throw new Error("INVALID_IMAGE_INPUT");
  return [
    { type: "text", text: prompt },
    { type: "image", mime_type: match[1], data: match[2] },
  ];
}

export async function generateImage(input: {
  prompt: string;
  imageData?: string;
  aspectRatio?: string;
  imageSize?: string;
  signal?: AbortSignal;
}) {
  const payload = await request("/interactions", {
    method: "POST",
    body: JSON.stringify({
      model: process.env.GEMINI_IMAGE_MODEL?.trim() || "gemini-3.1-flash-image",
      input: inputParts(input.prompt, input.imageData),
      response_format: {
        type: "image",
        mime_type: "image/png",
        aspect_ratio: input.aspectRatio || "1:1",
        image_size: input.imageSize || process.env.GEMINI_IMAGE_SIZE?.trim() || "1K",
        delivery: "inline",
      },
    }),
  }, input.signal);

  const block = modelOutput(payload, "image");
  const data = typeof block?.data === "string" ? block.data : "";
  const mimeType = typeof block?.mime_type === "string" ? block.mime_type : "image/png";
  if (!data) throw new AiProviderError({ provider: "gemini", code: "EMPTY_RESPONSE", failoverable: true });
  return { data, mimeType };
}

export async function startVideo(input: {
  prompt: string;
  imageData?: string;
  aspectRatio?: string;
  resolution?: string;
  signal?: AbortSignal;
}) {
  const payload = await request("/interactions", {
    method: "POST",
    body: JSON.stringify({
      model: process.env.GEMINI_VIDEO_MODEL?.trim() || "gemini-omni-1.1-flash",
      input: inputParts(input.prompt, input.imageData),
      response_format: {
        type: "video",
        delivery: "uri",
        aspect_ratio: input.aspectRatio || process.env.GEMINI_VIDEO_ASPECT_RATIO?.trim() || "16:9",
        resolution: input.resolution || process.env.GEMINI_VIDEO_RESOLUTION?.trim() || "720p",
      },
    }),
  }, input.signal);

  const id = typeof payload.id === "string" ? payload.id : "";
  const block = modelOutput(payload, "video");
  const fileUri = typeof block?.uri === "string" ? block.uri : "";
  if (!id || !fileUri) {
    throw new AiProviderError({ provider: "gemini", code: "INVALID_MEDIA_RESPONSE", failoverable: true });
  }
  return { interactionId: id, fileUri };
}

export async function getInteraction(interactionId: string, signal?: AbortSignal) {
  return request("/interactions/" + encodeURIComponent(interactionId), { method: "GET" }, signal);
}

export async function getFileState(fileUri: string, signal?: AbortSignal) {
  const match = fileUri.match(/\\/files\\/([^/:?]+)/);
  if (!match) throw new Error("INVALID_FILE_URI");
  return request("/files/" + encodeURIComponent(match[1]), { method: "GET" }, signal);
}

export async function downloadFile(fileUri: string, signal?: AbortSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });

  try {
    const url = new URL(fileUri);
    url.searchParams.set("key", getKey());
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: "*/*" } });
    if (!response.ok || !response.body) throw new AiProviderError({ provider: "gemini", code: "MEDIA_DOWNLOAD_FAILED", status: response.status, retryable: response.status >= 500, failoverable: response.status >= 500 });
    return { body: response.body, contentType: response.headers.get("content-type") || "video/mp4" };
  } catch (error) {
    if (error instanceof AiProviderError) throw error;
    if (controller.signal.aborted) throw new AiProviderError({ provider: "gemini", code: "TIMEOUT", retryable: true, failoverable: true });
    throw new AiProviderError({ provider: "gemini", code: "MEDIA_DOWNLOAD_FAILED", retryable: true, failoverable: true });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
