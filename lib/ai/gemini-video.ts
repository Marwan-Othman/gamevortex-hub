import { AiProviderError } from "@/lib/ai/types";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-omni-1.1-flash";
const TIMEOUT_MS = 300_000;
const POLL_INTERVAL_MS = 5_000;

function key() {
  const value = process.env.GEMINI_API_KEY?.trim();
  if (!value) throw new AiProviderError({ provider: "gemini", code: "NOT_CONFIGURED" });
  if (value.length > 4096 || /[\r\n]/.test(value)) throw new AiProviderError({ provider: "gemini", code: "CONFIGURATION_INVALID" });
  return value;
}

function providerError(status: number, body: unknown) {
  const message = body && typeof body === "object" && "error" in body
    ? String(((body as { error?: { message?: unknown } }).error?.message) || "")
    : "";
  if (status === 401 || status === 403) return new AiProviderError({ provider: "gemini", code: "AUTH_FAILED", status, failoverable: true });
  if (status === 429) return new AiProviderError({ provider: "gemini", code: "RATE_LIMITED", status, retryable: true, failoverable: true });
  if (status >= 500) return new AiProviderError({ provider: "gemini", code: "UNAVAILABLE", status, retryable: true, failoverable: true });
  return new AiProviderError({ provider: "gemini", code: message.toLowerCase().includes("billing") ? "BILLING_REQUIRED" : "PROVIDER_ERROR", status });
}

async function request(path: string, init: RequestInit, signal?: AbortSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });

  try {
    const response = await fetch(BASE_URL + path, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-goog-api-key": key(),
        ...(init.headers || {}),
      },
      cache: "no-store",
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw providerError(response.status, body);
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof AiProviderError) throw error;
    if (controller.signal.aborted) throw new AiProviderError({ provider: "gemini", code: "TIMEOUT", retryable: true, failoverable: true });
    throw new AiProviderError({ provider: "gemini", code: "UNAVAILABLE", retryable: true, failoverable: true });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

function videoFromSteps(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const steps = (payload as { steps?: unknown }).steps;
  if (!Array.isArray(steps)) return null;

  for (const step of steps) {
    if (!step || typeof step !== "object" || (step as { type?: unknown }).type !== "model_output") continue;
    const content = (step as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;

    for (const item of content) {
      if (!item || typeof item !== "object" || (item as { type?: unknown }).type !== "video") continue;
      const data = (item as { data?: unknown }).data;
      const uri = (item as { uri?: unknown }).uri;
      const mimeType = typeof (item as { mime_type?: unknown }).mime_type === "string"
        ? String((item as { mime_type: string }).mime_type)
        : "video/mp4";

      if (typeof data === "string" && data.length > 0) return { data, mimeType };
      if (typeof uri === "string" && uri.length > 0) return { uri, mimeType };
    }
  }
  return null;
}

function videoFromSdkShape(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const output = (payload as { output_video?: unknown }).output_video;
  if (!output || typeof output !== "object") return null;
  const data = (output as { data?: unknown }).data;
  const uri = (output as { uri?: unknown }).uri;
  if (typeof data === "string" && data.length > 0) return { data, mimeType: "video/mp4" };
  if (typeof uri === "string" && uri.length > 0) return { uri, mimeType: "video/mp4" };
  return null;
}

function fileIdFromUri(uri: string) {
  const match = uri.match(/\/files\/([^/?#:]+)/);
  return match?.[1] || null;
}

async function downloadGeneratedVideo(uri: string) {
  const fileId = fileIdFromUri(uri);
  if (!fileId) throw new AiProviderError({ provider: "gemini", code: "VIDEO_FILE_URI_INVALID", failoverable: true });

  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const info = await request("/files/" + encodeURIComponent(fileId), { method: "GET" });
    const state = info.state;
    if (state === "FAILED") throw new AiProviderError({ provider: "gemini", code: "VIDEO_GENERATION_FAILED", failoverable: true });
    if (state === "ACTIVE") {
      const response = await fetch(
        BASE_URL + "/files/" + encodeURIComponent(fileId) + ":download?alt=media",
        { method: "GET", headers: { "x-goog-api-key": key() }, cache: "no-store" },
      );
      if (!response.ok) throw providerError(response.status, await response.json().catch(() => null));
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length) throw new AiProviderError({ provider: "gemini", code: "VIDEO_EMPTY", failoverable: true });
      return bytes;
    }
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new AiProviderError({ provider: "gemini", code: "TIMEOUT", retryable: true, failoverable: true });
}

export async function geminiVideo(prompt: string, image?: { base64: string; mimeType: string }) {
  const model = process.env.GEMINI_VIDEO_MODEL?.trim() || DEFAULT_MODEL;
  const input = image
    ? [
        { type: "image", data: image.base64, mime_type: image.mimeType },
        { type: "text", text: prompt },
      ]
    : prompt;
  const resolution = process.env.GEMINI_VIDEO_RESOLUTION === "1080p"
    ? "1080p"
    : process.env.GEMINI_VIDEO_RESOLUTION === "4k"
      ? "4k"
      : "720p";
  const aspectRatio = process.env.GEMINI_VIDEO_ASPECT_RATIO === "16:9" ? "16:9" : "9:16";
  const started = Date.now();

  const result = await request("/interactions", {
    method: "POST",
    body: JSON.stringify({
      model,
      input,
      response_format: {
        type: "video",
        delivery: "uri",
        aspect_ratio: aspectRatio,
        resolution,
      },
    }),
  });

  const output = videoFromSteps(result) || videoFromSdkShape(result);
  if (!output) throw new AiProviderError({ provider: "gemini", code: "VIDEO_NOT_RETURNED", failoverable: true });

  const buffer = "data" in output
    ? Buffer.from(output.data, "base64")
    : await downloadGeneratedVideo(output.uri);

  if (!buffer.length) throw new AiProviderError({ provider: "gemini", code: "VIDEO_EMPTY", failoverable: true });

  return {
    model,
    operationName: typeof result.id === "string" ? result.id : undefined,
    buffer,
    mimeType: output.mimeType,
    latencyMs: Date.now() - started,
  };
}
