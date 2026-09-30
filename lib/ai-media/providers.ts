/**
 * GameVortex AI Media Provider
 *
 * Image generation is powered server-side by the Gemini API.
 *
 * IMPORTANT:
 * - GEMINI_API_KEY is server-only.
 * - Never expose it through NEXT_PUBLIC_* variables.
 * - Video generation remains disabled for now.
 *
 * The Prisma provider enum remains INTERNAL because GameVortex
 * intentionally exposes a single internal media adapter to the
 * rest of the application. Gemini is an implementation detail
 * of that adapter.
 */

export type ImageResult = {
  requestId: string;
  url: string;
  model: string;
};

export type VideoCreateResult = {
  taskId: string;
  model: string;
};

export type VideoStatusResult = {
  status?: string;
  file_id?: string;
  base_resp?: {
    status_msg?: string;
  };
};

const GEMINI_API_BASE =
  "https://generativelanguage.googleapis.com/v1";

const DEFAULT_IMAGE_MODEL = "gemini-3.1-flash-image";

const IMAGE_TIMEOUT_MS = 180_000;

function getGeminiApiKey() {
  const value = process.env.GEMINI_API_KEY?.trim();

  if (!value) {
    throw new Error("GEMINI_API_KEY_NOT_CONFIGURED");
  }

  return value;
}

function getImageModel() {
  return (
    process.env.GEMINI_IMAGE_MODEL?.trim() ||
    DEFAULT_IMAGE_MODEL
  );
}

function normalizeAspectRatio(
  value: string | undefined,
) {
  const allowed = new Set([
    "1:1",
    "1:4",
    "1:8",
    "2:3",
    "3:2",
    "3:4",
    "4:1",
    "4:3",
    "4:5",
    "5:4",
    "8:1",
    "9:16",
    "16:9",
    "21:9",
  ]);

  if (value && allowed.has(value)) {
    return value;
  }

  return "9:16";
}

function createRequestId() {
  return `gemini-image-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function extractImageFromResponse(
  body: unknown,
): {
  base64: string;
  mimeType: string;
} | null {
  if (
    !body ||
    typeof body !== "object" ||
    !("candidates" in body)
  ) {
    return null;
  }

  const candidates = (
    body as {
      candidates?: unknown;
    }
  ).candidates;

  if (!Array.isArray(candidates)) {
    return null;
  }

  for (const candidate of candidates) {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      !("content" in candidate)
    ) {
      continue;
    }

    const content = (
      candidate as {
        content?: unknown;
      }
    ).content;

    if (
      !content ||
      typeof content !== "object" ||
      !("parts" in content)
    ) {
      continue;
    }

    const parts = (
      content as {
        parts?: unknown;
      }
    ).parts;

    if (!Array.isArray(parts)) {
      continue;
    }

    for (const part of parts) {
      if (
        !part ||
        typeof part !== "object" ||
        !("inlineData" in part)
      ) {
        continue;
      }

      const inlineData = (
        part as {
          inlineData?: unknown;
        }
      ).inlineData;

      if (
        !inlineData ||
        typeof inlineData !== "object"
      ) {
        continue;
      }

      const data = (
        inlineData as {
          data?: unknown;
          mimeType?: unknown;
        }
      ).data;

      const mimeType = (
        inlineData as {
          data?: unknown;
          mimeType?: unknown;
        }
      ).mimeType;

      if (
        typeof data === "string" &&
        data.length > 0
      ) {
        return {
          base64: data,
          mimeType:
            typeof mimeType === "string" &&
            mimeType.startsWith("image/")
              ? mimeType
              : "image/png",
        };
      }
    }
  }

  return null;
}

function extractGeminiError(
  body: unknown,
): string | null {
  if (
    !body ||
    typeof body !== "object" ||
    !("error" in body)
  ) {
    return null;
  }

  const error = (
    body as {
      error?: unknown;
    }
  ).error;

  if (
    !error ||
    typeof error !== "object"
  ) {
    return null;
  }

  const message = (
    error as {
      message?: unknown;
    }
  ).message;

  return typeof message === "string"
    ? message
    : null;
}

export async function generateImage(
  prompt: string,
  aspectRatio = "9:16",
): Promise<ImageResult> {
  const cleanPrompt = prompt.trim();

  if (!cleanPrompt) {
    throw new Error("AI_IMAGE_PROMPT_REQUIRED");
  }

  const apiKey = getGeminiApiKey();
  const model = getImageModel();
  const requestId = createRequestId();
  const ratio = normalizeAspectRatio(aspectRatio);

  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, IMAGE_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${GEMINI_API_BASE}/models/${encodeURIComponent(
        model,
      )}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: cleanPrompt,
                },
              ],
            },
          ],
          generationConfig: {
            responseModalities: ["IMAGE"],
            responseFormat: {
              image: {
                aspectRatio: ratio,
              },
            },
          },
        }),
        signal: controller.signal,
        cache: "no-store",
      },
    );

    const rawBody = await response.text();

    let body: unknown = {};

    try {
      body = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      throw new Error(
        "GEMINI_INVALID_RESPONSE",
      );
    }

    if (!response.ok) {
      const providerMessage =
        extractGeminiError(body);

      console.error(
        "Gemini image generation failed:",
        {
          requestId,
          status: response.status,
          message: providerMessage,
        },
      );

      if (
        response.status === 401 ||
        response.status === 403
      ) {
        throw new Error(
          "GEMINI_AUTH_FAILED",
        );
      }

      if (response.status === 429) {
        throw new Error(
          "GEMINI_RATE_LIMITED",
        );
      }

      throw new Error(
        "GEMINI_IMAGE_GENERATION_FAILED",
      );
    }

    const image =
      extractImageFromResponse(body);

    if (!image) {
      console.error(
        "Gemini returned no image:",
        {
          requestId,
          model,
        },
      );

      throw new Error(
        "GEMINI_IMAGE_NOT_RETURNED",
      );
    }

    /*
     * The provider adapter returns a data URL.
     *
     * The API route is responsible for storing this image
     * in Vercel Blob and returning the permanent public URL.
     */
    const dataUrl = `data:${image.mimeType};base64,${image.base64}`;

    return {
      requestId,
      url: dataUrl,
      model,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === "AbortError"
    ) {
      throw new Error(
        "GEMINI_IMAGE_TIMEOUT",
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function createVideo(
  _prompt: string,
  _model?: string,
): Promise<VideoCreateResult> {
  throw new Error(
    "AI_VIDEO_GENERATION_NOT_ENABLED",
  );
}

export async function getVideoStatus(
  _taskId: string,
): Promise<VideoStatusResult> {
  throw new Error(
    "AI_VIDEO_GENERATION_NOT_ENABLED",
  );
}

export async function retrieveFile(
  _fileId: string,
): Promise<string> {
  throw new Error(
    "AI_VIDEO_GENERATION_NOT_ENABLED",
  );
}
