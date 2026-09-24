const FAL_BASE_URL = "https://fal.run";
const DEFAULT_IMAGE_MODEL = "fal-ai/flux-2/turbo";

/**
 * GameVortex self-hosted image engine.
 *
 * This endpoint will be enabled only after the GameVortex
 * image inference server is actually deployed.
 *
 * Expected API:
 *
 * POST {GAMEVORTEX_IMAGE_BASE_URL}/generate
 *
 * Request:
 * {
 *   prompt: string,
 *   imageSize?: string,
 *   numImages?: number
 * }
 *
 * Response:
 * {
 *   images: [
 *     { url: string }
 *   ]
 * }
 *
 * IMPORTANT:
 * The URL and API key are server-side only.
 * Never expose them through NEXT_PUBLIC_* variables.
 */
function getGameVortexImageConfig() {
  const baseUrl =
    process.env.GAMEVORTEX_IMAGE_BASE_URL
      ?.trim()
      .replace(/\/+$/, "") || "";

  const apiKey =
    process.env.GAMEVORTEX_IMAGE_API_KEY
      ?.trim() || "";

  const model =
    process.env.GAMEVORTEX_IMAGE_MODEL
      ?.trim() ||
    "gamevortex-image";

  return {
    baseUrl,
    apiKey,
    model,
  };
}

/**
 * Provider selection.
 *
 * Until the GameVortex Image Engine is actually deployed,
 * fal.ai remains the active provider.
 *
 * Supported values:
 *
 * GAMEVORTEX
 * FAL
 *
 * Default:
 *
 * FAL
 */
function getImageProvider(): "GAMEVORTEX" | "FAL" {
  const provider =
    process.env.GAMEVORTEX_IMAGE_PROVIDER
      ?.trim()
      .toUpperCase();

  if (provider === "GAMEVORTEX") {
    return "GAMEVORTEX";
  }

  return "FAL";
}

export class FalProviderError extends Error {
  readonly status?: number;
  readonly requestId?: string;

  constructor(
    message: string,
    status?: number,
    requestId?: string,
  ) {
    super(message);
    this.name = "FalProviderError";
    this.status = status;
    this.requestId = requestId;
  }
}

function getKey(): string {
  const key =
    process.env.FAL_KEY?.trim();

  if (!key) {
    throw new FalProviderError(
      "FAL_NOT_CONFIGURED",
    );
  }

  return key;
}

function getImageModel(): string {
  return (
    process.env.FAL_IMAGE_MODEL?.trim() ||
    DEFAULT_IMAGE_MODEL
  );
}

async function parseResponse(
  response: Response,
): Promise<Record<string, unknown>> {
  let data: unknown = null;

  try {
    data = await response.json();
  } catch {
    throw new FalProviderError(
      `FAL_INVALID_RESPONSE_${response.status}`,
      response.status,
    );
  }

  if (!response.ok) {
    const object =
      data &&
      typeof data === "object"
        ? (data as Record<string, unknown>)
        : {};

    const message =
      typeof object.detail === "string"
        ? object.detail
        : typeof object.message === "string"
          ? object.message
          : "FAL_PROVIDER_ERROR";

    throw new FalProviderError(
      message.slice(0, 500),
      response.status,
    );
  }

  return data as Record<string, unknown>;
}

/**
 * Parses a response from the GameVortex image engine.
 *
 * The self-hosted server intentionally uses a very small,
 * provider-independent response format so the rest of the
 * application does not need to know which image model is
 * running underneath.
 */
async function parseGameVortexResponse(
  response: Response,
): Promise<Record<string, unknown>> {
  let data: unknown = null;

  try {
    data = await response.json();
  } catch {
    throw new FalProviderError(
      `GAMEVORTEX_IMAGE_INVALID_RESPONSE_${response.status}`,
      response.status,
    );
  }

  const object =
    data &&
    typeof data === "object"
      ? (data as Record<string, unknown>)
      : {};

  if (!response.ok) {
    const message =
      typeof object.message === "string"
        ? object.message
        : typeof object.error === "string"
          ? object.error
          : "GAMEVORTEX_IMAGE_PROVIDER_ERROR";

    throw new FalProviderError(
      message.slice(0, 500),
      response.status,
    );
  }

  return object;
}

/**
 * Extracts image URLs from the common GameVortex image
 * engine response.
 *
 * Supported:
 *
 * {
 *   images: [
 *     { url: "https://..." }
 *   ]
 * }
 *
 * and:
 *
 * {
 *   images: [
 *     "https://..."
 *   ]
 * }
 */
function extractGameVortexImageUrls(
  data: Record<string, unknown>,
): string[] {
  const images = Array.isArray(
    data.images,
  )
    ? data.images
    : [];

  return images
    .map((item) => {
      if (
        typeof item === "string"
      ) {
        return item;
      }

      if (
        item &&
        typeof item === "object"
      ) {
        const object =
          item as Record<
            string,
            unknown
          >;

        return typeof object.url ===
          "string"
          ? object.url
          : null;
      }

      return null;
    })
    .filter(
      (
        url,
      ): url is string =>
        typeof url === "string" &&
        /^https?:\/\//i.test(url),
    );
}

/**
 * Generates an image using the GameVortex self-hosted
 * image engine.
 *
 * This function is not used until:
 *
 * GAMEVORTEX_IMAGE_PROVIDER=GAMEVORTEX
 *
 * is explicitly enabled.
 */
async function generateWithGameVortex(
  input: {
    prompt: string;
    imageSize?: string;
    numImages?: number;
  },
) {
  const config =
    getGameVortexImageConfig();

  if (!config.baseUrl) {
    throw new FalProviderError(
      "GAMEVORTEX_IMAGE_NOT_CONFIGURED",
    );
  }

  const numberOfImages =
    Math.min(
      Math.max(
        input.numImages || 1,
        1,
      ),
      4,
    );

  const response =
    await fetch(
      `${config.baseUrl}/generate`,
      {
        method: "POST",

        headers: {
          ...(config.apiKey
            ? {
                Authorization:
                  `Bearer ${config.apiKey}`,
              }
            : {}),

          "Content-Type":
            "application/json",
        },

        body: JSON.stringify({
          prompt: input.prompt,

          imageSize:
            input.imageSize ||
            "landscape_4_3",

          numImages:
            numberOfImages,

          model:
            config.model,
        }),

        cache: "no-store",

        signal:
          AbortSignal.timeout(
            120_000,
          ),
      },
    );

  const data =
    await parseGameVortexResponse(
      response,
    );

  const urls =
    extractGameVortexImageUrls(
      data,
    );

  if (!urls.length) {
    throw new FalProviderError(
      "GAMEVORTEX_IMAGE_NO_RESULT",
      response.status,
    );
  }

  return {
    model: config.model,
    urls,
  };
}

/**
 * Generates an image.
 *
 * Current production behavior:
 *
 *   GAMEVORTEX_IMAGE_PROVIDER=FAL
 *        ↓
 *      fal.ai
 *
 * Future behavior:
 *
 *   GAMEVORTEX_IMAGE_PROVIDER=GAMEVORTEX
 *        ↓
 *   GameVortex Image Engine
 *
 * The caller does not need to know which provider is active.
 */
export async function generateImage(
  input: {
    prompt: string;
    imageSize?: string;
    numImages?: number;
  },
) {
  const provider =
    getImageProvider();

  if (
    provider === "GAMEVORTEX"
  ) {
    return generateWithGameVortex(
      input,
    );
  }

  const key = getKey();
  const model =
    getImageModel();

  const numberOfImages =
    Math.min(
      Math.max(
        input.numImages || 1,
        1,
      ),
      4,
    );

  const response =
    await fetch(
      `${FAL_BASE_URL}/${model}`,
      {
        method: "POST",

        headers: {
          Authorization:
            `Key ${key}`,

          "Content-Type":
            "application/json",
        },

        body: JSON.stringify({
          prompt:
            input.prompt,

          image_size:
            input.imageSize ||
            "landscape_4_3",

          num_images:
            numberOfImages,

          enable_safety_checker:
            true,
        }),

        cache: "no-store",

        signal:
          AbortSignal.timeout(
            60_000,
          ),
      },
    );

  const data =
    await parseResponse(
      response,
    );

  const images =
    Array.isArray(
      data.images,
    )
      ? data.images
      : [];

  const urls =
    images
      .map(
        (item) =>
          item &&
          typeof item === "object"
            ? (
                item as Record<
                  string,
                  unknown
                >
              ).url
            : null,
      )
      .filter(
        (
          url,
        ): url is string =>
          typeof url ===
            "string" &&
          /^https?:\/\//i.test(
            url,
          ),
      );

  if (!urls.length) {
    throw new FalProviderError(
      "FAL_NO_IMAGE_RESULT",
      response.status,
    );
  }

  return {
    model,
    urls,
  };
}
