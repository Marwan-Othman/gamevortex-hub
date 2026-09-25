const DEFAULT_BASE_URL = "https://api.minimax.io/v1";
const DEFAULT_VIDEO_MODEL = "MiniMax-Hailuo-2.3";

/**
 * GameVortex self-hosted video engine configuration.
 *
 * This will be enabled only after the GameVortex video
 * inference server is deployed and tested.
 *
 * Expected API:
 *
 * POST {GAMEVORTEX_VIDEO_BASE_URL}/generate
 *
 * Request:
 * {
 *   prompt: string,
 *   imageUrl?: string,
 *   duration?: number,
 *   resolution?: string,
 *   model?: string
 * }
 *
 * Response:
 * {
 *   taskId: string
 * }
 *
 * Status API:
 *
 * GET {GAMEVORTEX_VIDEO_BASE_URL}/status?taskId=...
 *
 * Response:
 * {
 *   status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED",
 *   url?: string,
 *   fileId?: string
 * }
 *
 * IMPORTANT:
 * API keys remain server-side.
 * Never use NEXT_PUBLIC_* variables for these values.
 */
function getGameVortexVideoConfig() {
  const baseUrl =
    process.env.GAMEVORTEX_VIDEO_BASE_URL
      ?.trim()
      .replace(/\/+$/, "") || "";

  const apiKey =
    process.env.GAMEVORTEX_VIDEO_API_KEY
      ?.trim() || "";

  const model =
    process.env.GAMEVORTEX_VIDEO_MODEL
      ?.trim() ||
    "gamevortex-video";

  return {
    baseUrl,
    apiKey,
    model,
  };
}

/**
 * Provider selection.
 *
 * Current production default:
 *   MINIMAX
 *
 * Future:
 *   GAMEVORTEX
 *
 * We intentionally do NOT enable GameVortex automatically.
 * The self-hosted video server must exist before switching
 * this value.
 */
function getVideoProvider():
  | "GAMEVORTEX"
  | "MINIMAX" {
  const provider =
    process.env.GAMEVORTEX_VIDEO_PROVIDER
      ?.trim()
      .toUpperCase();

  if (provider === "GAMEVORTEX") {
    return "GAMEVORTEX";
  }

  return "MINIMAX";
}

export class MiniMaxProviderError extends Error {
  readonly status?: number;

  constructor(
    message: string,
    status?: number,
  ) {
    super(message);
    this.name =
      "MiniMaxProviderError";
    this.status = status;
  }
}

function getConfig() {
  const key =
    process.env.MINIMAX_API_KEY?.trim();

  if (!key) {
    throw new MiniMaxProviderError(
      "MINIMAX_NOT_CONFIGURED",
    );
  }

  const configuredBase =
    process.env.MINIMAX_API_BASE_URL?.trim() ||
    DEFAULT_BASE_URL;

  const baseWithoutTrailingSlash =
    configuredBase.replace(
      /\/+$/,
      "",
    );

  const base =
    baseWithoutTrailingSlash.endsWith(
      "/v1",
    )
      ? baseWithoutTrailingSlash
      : `${baseWithoutTrailingSlash}/v1`;

  const model =
    process.env.MINIMAX_VIDEO_MODEL?.trim() ||
    DEFAULT_VIDEO_MODEL;

  return {
    key,
    base,
    model,
  };
}

function normalizeProviderError(
  status: number,
  providerMessage?: string,
): MiniMaxProviderError {
  if (
    status === 401 ||
    status === 403
  ) {
    return new MiniMaxProviderError(
      "MINIMAX_UNAUTHORIZED",
      status,
    );
  }

  if (
    status === 408 ||
    status === 504
  ) {
    return new MiniMaxProviderError(
      "MINIMAX_TIMEOUT",
      status,
    );
  }

  if (status === 429) {
    return new MiniMaxProviderError(
      "MINIMAX_RATE_LIMITED",
      status,
    );
  }

  if (
    status >= 400 &&
    status < 500
  ) {
    return new MiniMaxProviderError(
      "MINIMAX_BAD_REQUEST",
      status,
    );
  }

  if (status >= 500) {
    return new MiniMaxProviderError(
      "MINIMAX_SERVER_ERROR",
      status,
    );
  }

  return new MiniMaxProviderError(
    providerMessage?.slice(0, 500) ||
      "MINIMAX_PROVIDER_ERROR",
    status,
  );
}

async function parseJson(
  response: Response,
): Promise<Record<string, unknown>> {
  let data: unknown;

  try {
    data =
      await response.json();
  } catch {
    if (!response.ok) {
      throw normalizeProviderError(
        response.status,
      );
    }

    throw new MiniMaxProviderError(
      `MINIMAX_INVALID_RESPONSE_${response.status}`,
      response.status,
    );
  }

  const object =
    data &&
    typeof data === "object"
      ? (data as Record<
          string,
          unknown
        >)
      : {};

  if (!response.ok) {
    const baseResp =
      object.base_resp &&
      typeof object.base_resp ===
        "object"
        ? (object.base_resp as Record<
            string,
            unknown
          >)
        : {};

    const providerMessage =
      typeof baseResp.status_msg ===
      "string"
        ? baseResp.status_msg
        : typeof object.message ===
            "string"
          ? object.message
          : undefined;

    throw normalizeProviderError(
      response.status,
      providerMessage,
    );
  }

  return object;
}

function assertProviderSuccess(
  data: Record<string, unknown>,
) {
  const baseResp =
    data.base_resp &&
    typeof data.base_resp ===
      "object"
      ? (data.base_resp as Record<
          string,
          unknown
        >)
      : null;

  const code =
    baseResp?.status_code;

  if (
    typeof code === "number" &&
    code !== 0
  ) {
    const message =
      typeof baseResp?.status_msg ===
      "string"
        ? baseResp.status_msg.slice(
            0,
            500,
          )
        : "MINIMAX_PROVIDER_ERROR";

    const normalized =
      message.toLowerCase();

    if (
      normalized.includes("rate") ||
      normalized.includes("limit") ||
      normalized.includes("quota")
    ) {
      throw new MiniMaxProviderError(
        "MINIMAX_RATE_LIMITED",
      );
    }

    if (
      normalized.includes(
        "unauthorized",
      ) ||
      normalized.includes(
        "authentication",
      ) ||
      normalized.includes(
        "permission",
      )
    ) {
      throw new MiniMaxProviderError(
        "MINIMAX_UNAUTHORIZED",
      );
    }

    if (
      normalized.includes(
        "timeout",
      ) ||
      normalized.includes(
        "timed out",
      )
    ) {
      throw new MiniMaxProviderError(
        "MINIMAX_TIMEOUT",
      );
    }

    if (
      normalized.includes(
        "invalid",
      ) ||
      normalized.includes(
        "parameter",
      ) ||
      normalized.includes(
        "request",
      )
    ) {
      throw new MiniMaxProviderError(
        "MINIMAX_BAD_REQUEST",
      );
    }

    throw new MiniMaxProviderError(
      message,
    );
  }
}

async function fetchJson(
  url: string,
  options: RequestInit,
  timeoutMs: number,
) {
  let response: Response;

  try {
    response =
      await fetch(url, {
        ...options,
        cache: "no-store",
        signal:
          AbortSignal.timeout(
            timeoutMs,
          ),
      });
  } catch (error) {
    if (
      error instanceof Error &&
      (
        error.name ===
          "AbortError" ||
        error.name ===
          "TimeoutError"
      )
    ) {
      throw new MiniMaxProviderError(
        "MINIMAX_TIMEOUT",
        504,
      );
    }

    throw new MiniMaxProviderError(
      "MINIMAX_SERVER_ERROR",
    );
  }

  return parseJson(response);
}

/* =========================================================
 * GAMEVORTEX VIDEO ENGINE
 * ======================================================= */

async function parseGameVortexResponse(
  response: Response,
): Promise<Record<string, unknown>> {
  let data: unknown;

  try {
    data =
      await response.json();
  } catch {
    throw new MiniMaxProviderError(
      `GAMEVORTEX_VIDEO_INVALID_RESPONSE_${response.status}`,
      response.status,
    );
  }

  const object =
    data &&
    typeof data === "object"
      ? (data as Record<
          string,
          unknown
        >)
      : {};

  if (!response.ok) {
    const message =
      typeof object.message ===
      "string"
        ? object.message
        : typeof object.error ===
            "string"
          ? object.error
          : "GAMEVORTEX_VIDEO_PROVIDER_ERROR";

    throw new MiniMaxProviderError(
      message.slice(0, 500),
      response.status,
    );
  }

  return object;
}

function normalizeGameVortexStatus(
  value: unknown,
):
  | "QUEUED"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED" {
  if (
    typeof value !== "string"
  ) {
    return "PROCESSING";
  }

  const normalized =
    value
      .trim()
      .toUpperCase();

  switch (normalized) {
    case "QUEUED":
    case "PENDING":
      return "QUEUED";

    case "PROCESSING":
    case "RUNNING":
    case "PREPARING":
      return "PROCESSING";

    case "COMPLETED":
    case "COMPLETE":
    case "SUCCESS":
    case "SUCCEEDED":
      return "COMPLETED";

    case "FAILED":
    case "FAIL":
    case "ERROR":
      return "FAILED";

    default:
      return "PROCESSING";
  }
}

async function createVideoWithGameVortex(
  input: {
    prompt: string;
    imageUrl?: string;
    duration?: number;
    resolution?: string;
  },
) {
  const config =
    getGameVortexVideoConfig();

  if (!config.baseUrl) {
    throw new MiniMaxProviderError(
      "GAMEVORTEX_VIDEO_NOT_CONFIGURED",
    );
  }

  const duration =
    Math.min(
      Math.max(
        Math.floor(
          input.duration || 6,
        ),
        1,
      ),
      15,
    );

  const resolution =
    typeof input.resolution ===
      "string" &&
    input.resolution.trim()
      .length > 0
      ? input.resolution.trim()
      : "768P";

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
          prompt:
            input.prompt,

          imageUrl:
            input.imageUrl,

          duration,

          resolution,

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

  const taskId =
    typeof data.taskId ===
    "string"
      ? data.taskId
      : typeof data.task_id ===
          "string"
        ? data.task_id
        : null;

  if (!taskId) {
    throw new MiniMaxProviderError(
      "GAMEVORTEX_VIDEO_NO_TASK_ID",
      response.status,
    );
  }

  return {
    taskId,
    model: config.model,
  };
}

async function getVideoStatusFromGameVortex(
  taskId: string,
) {
  const config =
    getGameVortexVideoConfig();

  if (!config.baseUrl) {
    throw new MiniMaxProviderError(
      "GAMEVORTEX_VIDEO_NOT_CONFIGURED",
    );
  }

  if (
    !taskId ||
    taskId.trim().length === 0
  ) {
    throw new MiniMaxProviderError(
      "MINIMAX_BAD_REQUEST",
      400,
    );
  }

  const response =
    await fetch(
      `${config.baseUrl}/status?taskId=${encodeURIComponent(
        taskId,
      )}`,
      {
        headers: {
          ...(config.apiKey
            ? {
                Authorization:
                  `Bearer ${config.apiKey}`,
              }
            : {}),
        },

        cache: "no-store",

        signal:
          AbortSignal.timeout(
            30_000,
          ),
      },
    );

  const data =
    await parseGameVortexResponse(
      response,
    );

  const status =
    normalizeGameVortexStatus(
      data.status,
    );

  const url =
    typeof data.url ===
    "string"
      ? data.url
      : null;

  const fileId =
    typeof data.fileId ===
    "string"
      ? data.fileId
      : typeof data.file_id ===
          "string"
        ? data.file_id
        : null;

  return {
    status,
    fileId,
    url,
  };
}

/* =========================================================
 * PUBLIC VIDEO API
 * ======================================================= */

export async function createVideo(
  input: {
    prompt: string;
    imageUrl?: string;
    duration?: number;
    resolution?: string;
  },
) {
  const provider =
    getVideoProvider();

  if (
    provider === "GAMEVORTEX"
  ) {
    return createVideoWithGameVortex(
      input,
    );
  }

  const {
    key,
    base,
    model,
  } = getConfig();

  /*
   * Hailuo video generation is
   * asynchronous.
   */
  const duration =
    Math.min(
      Math.max(
        Math.floor(
          input.duration || 6,
        ),
        1,
      ),
      15,
    );

  const resolution =
    typeof input.resolution ===
      "string" &&
    input.resolution.trim()
      .length > 0
      ? input.resolution.trim()
      : "768P";

  const body: Record<
    string,
    unknown
  > = {
    model,
    prompt:
      input.prompt,
    duration,
    resolution,
  };

  if (input.imageUrl) {
    body.first_frame_image =
      input.imageUrl;
  }

  const data =
    await fetchJson(
      `${base}/video_generation`,
      {
        method: "POST",

        headers: {
          Authorization:
            `Bearer ${key}`,

          "Content-Type":
            "application/json",
        },

        body: JSON.stringify(
          body,
        ),
      },
      30_000,
    );

  assertProviderSuccess(
    data,
  );

  const taskId =
    typeof data.task_id ===
    "string"
      ? data.task_id
      : null;

  if (!taskId) {
    throw new MiniMaxProviderError(
      "MINIMAX_NO_TASK_ID",
    );
  }

  return {
    taskId,
    model,
  };
}

export async function getVideoStatus(
  taskId: string,
) {
  const provider =
    getVideoProvider();

  if (
    provider === "GAMEVORTEX"
  ) {
    return getVideoStatusFromGameVortex(
      taskId,
    );
  }

  const {
    key,
    base,
  } = getConfig();

  if (
    !taskId ||
    taskId.trim().length === 0
  ) {
    throw new MiniMaxProviderError(
      "MINIMAX_BAD_REQUEST",
      400,
    );
  }

  const data =
    await fetchJson(
      `${base}/query/video_generation?task_id=${encodeURIComponent(
        taskId,
      )}`,
      {
        headers: {
          Authorization:
            `Bearer ${key}`,
        },
      },
      20_000,
    );

  assertProviderSuccess(
    data,
  );

  const status =
    typeof data.status ===
    "string"
      ? data.status
      : "Unknown";

  const fileId =
    typeof data.file_id ===
    "string"
      ? data.file_id
      : "";

  let url:
    | string
    | null = null;

  if (
    status === "Success" &&
    fileId
  ) {
    const fileData =
      await fetchJson(
        `${base}/files/retrieve?file_id=${encodeURIComponent(
          fileId,
        )}`,
        {
          headers: {
            Authorization:
              `Bearer ${key}`,
          },
        },
        20_000,
      );

    assertProviderSuccess(
      fileData,
    );

    const file =
      fileData.file &&
      typeof fileData.file ===
        "object"
        ? (fileData.file as Record<
            string,
            unknown
          >)
        : {};

    if (
      typeof file.download_url ===
        "string" &&
      file.download_url.length >
        0
    ) {
      url =
        file.download_url;
    }
  }

  return {
    status,
    fileId:
      fileId || null,
    url,
  };
}
