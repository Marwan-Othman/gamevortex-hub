/**
 * GameVortex AI Media Provider
 *
 * Server-side Gemini image generation adapter.
 *
 * IMPORTANT:
 * - GEMINI_API_KEY is server-only.
 * - Never expose it through NEXT_PUBLIC_* variables.
 * - Video generation remains disabled until the image system is finished.
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

/**
 * Gemini legacy generateContent REST endpoint.
 *
 * IMPORTANT:
 * gemini-3.1-flash-image supports generateContent.
 * The current Google documentation uses /v1/models/...:generateContent.
 */
const GEMINI_API_BASE =
  "https://generativelanguage.googleapis.com/v1/models";

const DEFAULT_IMAGE_MODEL =
  "gemini-3.1-flash-image";

/**
 * Start with 1K while verifying the integration.
 *
 * After successful production testing, this can be changed
 * to 2K or 4K for higher-resolution output.
 */
const DEFAULT_IMAGE_SIZE = "1K";

const IMAGE_TIMEOUT_MS = 180_000;

function getGeminiApiKey() {
  const value =
    process.env.GEMINI_API_KEY?.trim();

  if (!value) {
    throw new Error(
      "GEMINI_API_KEY_NOT_CONFIGURED",
    );
  }

  return value;
}

function getImageModel() {
  return (
    process.env.GEMINI_IMAGE_MODEL?.trim() ||
    DEFAULT_IMAGE_MODEL
  );
}

function getImageSize() {
  const configured =
    process.env.GEMINI_IMAGE_SIZE?.trim();

  if (
    configured === "512" ||
    configured === "1K" ||
    configured === "2K" ||
    configured === "4K"
  ) {
    return configured;
  }

  return DEFAULT_IMAGE_SIZE;
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

  return value && allowed.has(value)
    ? value
    : "1:1";
}

function createRequestId() {
  return `gemini-image-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function extractImageFromResponse(
  body: unknown,
) {
  if (
    !body ||
    typeof body !== "object" ||
    !("candidates" in body)
  ) {
    return null;
  }

  const candidates =
    (body as {
      candidates?: unknown;
    }).candidates;

  if (!Array.isArray(candidates)) {
    return null;
  }

  for (const candidate of candidates) {
    if (
      !candidate ||
      typeof candidate !== "object"
    ) {
      continue;
    }

    const content =
      (candidate as {
        content?: unknown;
      }).content;

    if (
      !content ||
      typeof content !== "object"
    ) {
      continue;
    }

    const parts =
      (content as {
        parts?: unknown;
      }).parts;

    if (!Array.isArray(parts)) {
      continue;
    }

    for (const part of parts) {
      if (
        !part ||
        typeof part !== "object"
      ) {
        continue;
      }

      const inlineData =
        (part as {
          inlineData?: unknown;
        }).inlineData;

      if (
        !inlineData ||
        typeof inlineData !== "object"
      ) {
        continue;
      }

      const data =
        (inlineData as {
          data?: unknown;
        }).data;

      const mimeType =
        (inlineData as {
          mimeType?: unknown;
        }).mimeType;

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
) {
  if (
    !body ||
    typeof body !== "object"
  ) {
    return null;
  }

  const error =
    (body as {
      error?: unknown;
    }).error;

  if (
    !error ||
    typeof error !== "object"
  ) {
    return null;
  }

  const message =
    (error as {
      message?: unknown;
    }).message;

  return typeof message === "string"
    ? message
    : null;
}

function classifyProviderFailure(
  status: number,
  message: string | null,
) {
  const normalized =
    (message || "").toLowerCase();

  if (
    status === 401 ||
    status === 403
  ) {
    return "GEMINI_AUTH_FAILED";
  }

  if (
    normalized.includes("billing") ||
    normalized.includes("paid tier") ||
    normalized.includes("payment") ||
    normalized.includes("pay-as-you-go")
  ) {
    return "GEMINI_IMAGE_BILLING_REQUIRED";
  }

  if (
    normalized.includes("quota") ||
    normalized.includes("resource exhausted") ||
    status === 429
  ) {
    return "GEMINI_RATE_LIMITED";
  }

  if (
    status === 408 ||
    status === 504
  ) {
    return "GEMINI_IMAGE_TIMEOUT";
  }

  return "GEMINI_IMAGE_GENERATION_FAILED";
}

export async function generateImage(
  prompt: string,
  aspectRatio = "1:1",
  inputImage?: {
    base64: string;
    mimeType: string;
  },
): Promise<ImageResult> {
  const cleanPrompt =
    prompt.trim();

  if (!cleanPrompt) {
    throw new Error(
      "AI_IMAGE_PROMPT_REQUIRED",
    );
  }

  const apiKey =
    getGeminiApiKey();

  const model =
    getImageModel();

  const imageSize =
    getImageSize();

  const requestId =
    createRequestId();

  const ratio =
    normalizeAspectRatio(
      aspectRatio,
    );

  const controller =
    new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    IMAGE_TIMEOUT_MS,
  );

  try {
    const endpoint =
      `${GEMINI_API_BASE}/${encodeURIComponent(
        model,
      )}:generateContent`;

    const requestBody = {
      contents: [
        {
          parts: [
            ...(inputImage
              ? [
                  {
                    inlineData: {
                      mimeType:
                        inputImage.mimeType,
                      data:
                        inputImage.base64,
                    },
                  },
                ]
              : []),

            {
              text: inputImage
                ? `Edit the provided image according to this instruction. Preserve identity and unchanged elements unless the user explicitly requests a change. ${cleanPrompt}`
                : cleanPrompt,
            },
          ],
        },
      ],

      generationConfig: {
        responseModalities: [
          "IMAGE",
        ],

        responseFormat: {
          image: {
            aspectRatio:
              ratio,

            imageSize,
          },
        },
      },
    };

    const response =
      await fetch(
        endpoint,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            Accept:
              "application/json",

            "x-goog-api-key":
              apiKey,
          },

          body:
            JSON.stringify(
              requestBody,
            ),

          signal:
            controller.signal,

          cache: "no-store",
        },
      );

    const rawBody =
      await response.text();

    let body: unknown = {};

    try {
      body = rawBody
        ? JSON.parse(rawBody)
        : {};
    } catch {
      console.error(
        "Gemini returned non-JSON response",
        {
          requestId,
          status:
            response.status,
          bodyPreview:
            rawBody.slice(0, 500),
        },
      );

      throw new Error(
        "GEMINI_INVALID_RESPONSE",
      );
    }

    if (!response.ok) {
      const providerMessage =
        extractGeminiError(body);

      const code =
        classifyProviderFailure(
          response.status,
          providerMessage,
        );

      console.error(
        "Gemini image generation failed",
        {
          requestId,

          status:
            response.status,

          code,

          model,

          message:
            providerMessage?.slice(
              0,
              500,
            ),
        },
      );

      throw new Error(code);
    }

    const image =
      extractImageFromResponse(
        body,
      );

    if (!image) {
      console.error(
        "Gemini returned no image",
        {
          requestId,

          model,

          responseKeys:
            body &&
            typeof body === "object"
              ? Object.keys(
                  body as Record<
                    string,
                    unknown
                  >,
                )
              : [],
        },
      );

      throw new Error(
        "GEMINI_IMAGE_NOT_RETURNED",
      );
    }

    return {
      requestId,

      url:
        `data:${image.mimeType};base64,${image.base64}`,

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
