import { AiProviderError } from "@/lib/ai/types";
import { parseImageData } from "@/lib/ai/validation";

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
// Routes that call these helpers have maxDuration = 300s. Every provider call
// must finish well inside that window, otherwise the platform kills the
// function before the credit refund in the route's catch block can run.
const DEFAULT_TIMEOUT_MS = 30_000;
const IMAGE_TIMEOUT_MS = 120_000;
const DOWNLOAD_TIMEOUT_MS = 240_000;
const MAX_DOWNLOAD_REDIRECTS = 3;

function getKey() {
  const value = process.env.GEMINI_API_KEY?.trim();
  if (!value) throw new AiProviderError({ provider: "gemini", code: "NOT_CONFIGURED" });
  if (value.length > 4096 || /[\r\n]/.test(value)) {
    throw new AiProviderError({ provider: "gemini", code: "CONFIGURATION_INVALID" });
  }
  return value;
}

async function request(path: string, init: RequestInit, signal?: AbortSignal, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
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
          : status === 408 || status === 504
            ? "TIMEOUT"
            : status >= 500
              ? "UNAVAILABLE"
              : "PROVIDER_ERROR";
      throw new AiProviderError({
        provider: "gemini",
        code,
        status,
        retryable: status === 408 || status === 429 || status >= 500,
        failoverable: status === 401 || status === 403 || status === 408 || status === 429 || status >= 500,
      });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      // 200 with an empty / non-JSON / non-object body: never treat it as success.
      throw new AiProviderError({ provider: "gemini", code: "INVALID_MEDIA_RESPONSE", failoverable: true });
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
  const response = payload as { steps?: unknown; output_image?: unknown; output_video?: unknown };

  // The Interactions API exposes generated media both in model_output steps
  // and, for image responses, as the convenience output_image field.
  const direct = type === "image" ? response.output_image : response.output_video;
  if (direct && typeof direct === "object" && !Array.isArray(direct)) {
    return direct as Record<string, unknown>;
  }

  const steps = response.steps;
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
  const image = parseImageData(imageData);
  return [
    { type: "text", text: prompt },
    { type: "image", mime_type: image.mimeType, data: image.data },
  ];
}

function videoInstance(prompt: string, imageData?: string) {
  if (!imageData) return { prompt };
  const image = parseImageData(imageData);
  return { prompt, image: { inlineData: { mimeType: image.mimeType, data: image.data } } };
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
      },
    }),
  }, input.signal, IMAGE_TIMEOUT_MS);

  const block = modelOutput(payload, "image");
  const data = typeof block?.data === "string" ? block.data.trim() : "";
  const rawMime = typeof block?.mime_type === "string" ? block.mime_type : "image/png";
  // Only ever relay image types back to the browser (the route sets Content-Type from this).
  const mimeType = /^image\/(png|jpeg|webp)$/.test(rawMime) ? rawMime : "image/png";
  if (!data || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    throw new AiProviderError({ provider: "gemini", code: "EMPTY_RESPONSE", failoverable: true });
  }
  return { data, mimeType };
}

export async function startVideo(input: {
  prompt: string;
  imageData?: string;
  aspectRatio?: string;
  resolution?: string;
  signal?: AbortSignal;
}) {
  const model = process.env.GEMINI_VIDEO_MODEL?.trim() || "veo-3.1-generate-preview";
  const parameters: Record<string, string | number> = {
    aspectRatio: input.aspectRatio || process.env.GEMINI_VIDEO_ASPECT_RATIO?.trim() || "16:9",
    resolution: input.resolution || process.env.GEMINI_VIDEO_RESOLUTION?.trim() || "720p",
    numberOfVideos: 1,
  };

  const payload = await request("/models/" + encodeURIComponent(model) + ":predictLongRunning", {
    method: "POST",
    body: JSON.stringify({
      instances: [videoInstance(input.prompt, input.imageData)],
      parameters,
    }),
  }, input.signal);

  const operationName = typeof payload.name === "string" ? payload.name : "";
  if (!operationName) {
    throw new AiProviderError({ provider: "gemini", code: "INVALID_MEDIA_RESPONSE", failoverable: true });
  }

  return { interactionId: operationName, model };
}

export async function getVideoOperation(operationName: string, signal?: AbortSignal) {
  if (!operationName || operationName.length > 512 || !/^[A-Za-z0-9_.\-/]+$/.test(operationName) || operationName.includes("..")) {
    throw new AiProviderError({ provider: "gemini", code: "INVALID_MEDIA_RESPONSE" });
  }
  return request("/" + operationName.replace(/^\/+/, ""), { method: "GET" }, signal);
}

export function getCompletedVideoUri(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const response = (payload as { response?: unknown }).response;
  if (!response || typeof response !== "object") return "";

  const generateVideoResponse = (response as { generateVideoResponse?: unknown }).generateVideoResponse;
  if (!generateVideoResponse || typeof generateVideoResponse !== "object") return "";

  const generatedSamples = (generateVideoResponse as { generatedSamples?: unknown }).generatedSamples;
  if (!Array.isArray(generatedSamples) || !generatedSamples[0] || typeof generatedSamples[0] !== "object") return "";

  const video = (generatedSamples[0] as { video?: unknown }).video;
  if (!video || typeof video !== "object") return "";

  return typeof (video as { uri?: unknown }).uri === "string"
    ? (video as { uri: string }).uri
    : "";
}

export async function getInteraction(interactionId: string, signal?: AbortSignal) {
  return request("/interactions/" + encodeURIComponent(interactionId), { method: "GET" }, signal);
}

export async function getFileState(fileUri: string, signal?: AbortSignal) {
  const match = fileUri.match(/\/files\/([^/:?]+)/);
  if (!match) throw new Error("INVALID_FILE_URI");
  return request("/files/" + encodeURIComponent(match[1]), { method: "GET" }, signal);
}

function isGoogleApiHost(url: URL) {
  return url.protocol === "https:" && (url.hostname === "googleapis.com" || url.hostname.endsWith(".googleapis.com"));
}

/**
 * Streams a generated video from Google.
 *
 * - The URI comes from a signed token that was built from a provider response,
 *   but it is still restricted to https + *.googleapis.com before the API key
 *   is attached.
 * - Redirects are followed by hand: fetch() would forward the custom
 *   x-goog-api-key header to whatever host the redirect points at.
 * - A Range header from the browser is forwarded so seeking works.
 */
export async function downloadFile(fileUri: string, signal?: AbortSignal, range?: string | null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });

  try {
    let url = new URL(fileUri);
    if (!isGoogleApiHost(url)) {
      throw new AiProviderError({ provider: "gemini", code: "MEDIA_DOWNLOAD_FAILED" });
    }

    for (let hop = 0; hop <= MAX_DOWNLOAD_REDIRECTS; hop += 1) {
      const headers: Record<string, string> = { Accept: "*/*" };
      if (isGoogleApiHost(url)) headers["x-goog-api-key"] = getKey();
      if (range && /^bytes=\d*-\d*$/.test(range)) headers.Range = range;

      const response = await fetch(url, { signal: controller.signal, headers, redirect: "manual" });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) break;
        const next = new URL(location, url);
        if (next.protocol !== "https:") break;
        url = next;
        continue;
      }

      if ((response.status !== 200 && response.status !== 206) || !response.body) {
        throw new AiProviderError({
          provider: "gemini",
          code: "MEDIA_DOWNLOAD_FAILED",
          status: response.status,
          retryable: response.status >= 500,
          failoverable: response.status >= 500,
        });
      }

      const upstreamType = response.headers.get("content-type") || "";
      return {
        body: response.body,
        status: response.status,
        contentType: /^video\//i.test(upstreamType) ? upstreamType : "video/mp4",
        contentLength: response.headers.get("content-length"),
        contentRange: response.headers.get("content-range"),
      };
    }
    throw new AiProviderError({ provider: "gemini", code: "MEDIA_DOWNLOAD_FAILED" });
  } catch (error) {
    if (error instanceof AiProviderError) throw error;
    if (controller.signal.aborted) {
      throw new AiProviderError({ provider: "gemini", code: "TIMEOUT", retryable: true, failoverable: true });
    }
    throw new AiProviderError({ provider: "gemini", code: "MEDIA_DOWNLOAD_FAILED", retryable: true, failoverable: true });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
