import { randomUUID } from "node:crypto";

import { logEvent } from "@/lib/observability";

import {
  gameVortexAiConfig,
  isGameVortexAiEnabled,
  openaiConfig,
  type ReasoningEffort,
} from "./config";

export type OpenAiMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type OpenAiRequestOptions = {
  maxOutputTokens?: number;
  reasoningEffort?: ReasoningEffort;
  timeoutMs?: number;
};

export type OpenAiResult = {
  text: string;
  requestId: string;
  openaiRequestId: string | null;
  model: string;
  latencyMs: number;
};

export type OpenAiErrorCode =
  | "OPENAI_NOT_CONFIGURED"
  | "OPENAI_TIMEOUT"
  | "OPENAI_RATE_LIMITED"
  | "OPENAI_UNAUTHORIZED"
  | "OPENAI_BAD_REQUEST"
  | "OPENAI_SERVER_ERROR"
  | "OPENAI_INVALID_RESPONSE"
  | "OPENAI_NETWORK_ERROR";

/**
 * Internal provider configuration.
 *
 * During the migration:
 *
 * OPENAI:
 *   Uses the OpenAI API.
 *
 * GAMEVORTEX:
 *   Uses the GameVortex self-hosted AI endpoint.
 *
 * Both providers use the same OpenAI-compatible Responses
 * API contract so the rest of GameVortex does not need to
 * know which provider is currently active.
 */
type ActiveProviderConfig = {
  provider: "GAMEVORTEX" | "OPENAI";
  baseUrl: string;
  apiKey: string;
  model: string;
};

function getActiveProviderConfig(
  requestId: string,
): ActiveProviderConfig {
  if (isGameVortexAiEnabled()) {
    if (!gameVortexAiConfig.baseUrl) {
      throw new OpenAiError(
        "GameVortex AI base URL is not configured",
        "OPENAI_NOT_CONFIGURED",
        requestId,
      );
    }

    return {
      provider: "GAMEVORTEX",
      baseUrl: gameVortexAiConfig.baseUrl,
      apiKey: gameVortexAiConfig.apiKey,
      model: gameVortexAiConfig.chatModel,
    };
  }

  const key = process.env.OPENAI_API_KEY?.trim();

  if (!key) {
    throw new OpenAiError(
      "OPENAI_API_KEY is not configured",
      "OPENAI_NOT_CONFIGURED",
      requestId,
    );
  }

  return {
    provider: "OPENAI",
    baseUrl: openaiConfig.baseUrl,
    apiKey: key,
    model: openaiConfig.model,
  };
}

/**
 * All errors thrown by this module are OpenAiError instances.
 *
 * `requestId` is our own internal id.
 *
 * It is safe to log or return for support purposes.
 * It is NEVER an API key.
 *
 * The class name is kept as OpenAiError for compatibility with
 * the existing chat route and current error handling.
 */
export class OpenAiError extends Error {
  readonly code: OpenAiErrorCode;
  readonly requestId: string;
  readonly statusCode?: number;

  constructor(
    message: string,
    code: OpenAiErrorCode,
    requestId: string,
    statusCode?: number,
  ) {
    super(message);
    this.name = "OpenAiError";
    this.code = code;
    this.requestId = requestId;
    this.statusCode = statusCode;
  }
}

function classifyStatus(
  status: number,
): OpenAiErrorCode {
  if (status === 401 || status === 403) {
    return "OPENAI_UNAUTHORIZED";
  }

  if (status === 429) {
    return "OPENAI_RATE_LIMITED";
  }

  if (status >= 500) {
    return "OPENAI_SERVER_ERROR";
  }

  return "OPENAI_BAD_REQUEST";
}

type ProviderError = {
  message: string;
  code: string | null;
};

async function parseErrorBody(
  response: Response,
): Promise<ProviderError> {
  try {
    const data: unknown = await response.json();

    const errorObj =
      data &&
      typeof data === "object" &&
      "error" in data &&
      data.error &&
      typeof data.error === "object"
        ? (data.error as Record<string, unknown>)
        : null;

    const message = errorObj?.message;
    const code = errorObj?.code;

    return {
      message:
        typeof message === "string"
          ? message.slice(0, 500)
          : "AI_PROVIDER_ERROR",

      code:
        typeof code === "string"
          ? code
          : null,
    };
  } catch {
    return {
      message: "AI_PROVIDER_ERROR",
      code: null,
    };
  }
}

/**
 * Maps a provider-declared error code and HTTP status to our
 * internal error codes.
 *
 * The existing public API contract is intentionally preserved
 * so the current /api/ai/chat route does not need to change.
 */
function mapProviderErrorCode(
  rawCode: string | null | undefined,
  httpStatus?: number,
): OpenAiErrorCode {
  const code =
    (rawCode ?? "").toLowerCase();

  if (
    httpStatus === 401 ||
    httpStatus === 403 ||
    code.includes("api_key") ||
    code.includes("unauthorized") ||
    code.includes("authentication") ||
    code.includes("permission")
  ) {
    return "OPENAI_UNAUTHORIZED";
  }

  if (
    httpStatus === 429 ||
    code.includes("rate_limit") ||
    code.includes("rate-limit") ||
    code.includes("quota") ||
    code.includes("too_many_requests")
  ) {
    return "OPENAI_RATE_LIMITED";
  }

  if (
    code.includes("invalid") ||
    code.includes("unsupported") ||
    code.includes("not_found") ||
    code.includes("context_length") ||
    code.includes("string_too_long") ||
    (httpStatus !== undefined &&
      httpStatus >= 400 &&
      httpStatus < 500)
  ) {
    return "OPENAI_BAD_REQUEST";
  }

  if (
    httpStatus !== undefined &&
    httpStatus >= 500
  ) {
    return "OPENAI_SERVER_ERROR";
  }

  return "OPENAI_SERVER_ERROR";
}

/**
 * Extracts the real error from a streaming event.
 *
 * Supports:
 *
 * - response.failed
 * - response.error
 * - error
 */
function extractStreamEventError(
  event: Record<string, unknown>,
): ProviderError {
  const response = event.response;

  if (
    response &&
    typeof response === "object"
  ) {
    const responseError =
      (response as Record<string, unknown>)
        .error;

    if (
      responseError &&
      typeof responseError === "object"
    ) {
      const message =
        (responseError as Record<string, unknown>)
          .message;

      const code =
        (responseError as Record<string, unknown>)
          .code;

      if (typeof message === "string") {
        return {
          message: message.slice(0, 500),
          code:
            typeof code === "string"
              ? code
              : null,
        };
      }
    }
  }

  const directError = event.error;

  if (
    directError &&
    typeof directError === "object"
  ) {
    const message =
      (directError as Record<string, unknown>)
        .message;

    const code =
      (directError as Record<string, unknown>)
        .code;

    if (typeof message === "string") {
      return {
        message: message.slice(0, 500),
        code:
          typeof code === "string"
            ? code
            : null,
      };
    }
  }

  const topLevelMessage =
    event.message;

  if (
    typeof topLevelMessage === "string"
  ) {
    return {
      message: topLevelMessage.slice(0, 500),
      code: null,
    };
  }

  return {
    message: "OPENAI_STREAM_FAILED",
    code: null,
  };
}

function toResponsesInput(
  messages: OpenAiMessage[],
) {
  return messages.map(
    (message) => ({
      role: message.role,
      content: [
        {
          type:
            message.role === "assistant"
              ? "output_text"
              : "input_text",

          text: message.content,
        },
      ],
    }),
  );
}

function extractOutputText(
  data: unknown,
): string {
  if (
    data &&
    typeof data === "object" &&
    "output_text" in data &&
    typeof (
      data as Record<string, unknown>
    ).output_text === "string"
  ) {
    return (
      data as Record<string, unknown>
    ).output_text as string;
  }

  const output =
    data &&
    typeof data === "object" &&
    "output" in data &&
    Array.isArray(
      (data as Record<string, unknown>)
        .output,
    )
      ? (
          (data as Record<string, unknown>)
            .output as unknown[]
        )
      : [];

  const chunks: string[] = [];

  for (const item of output) {
    if (
      item &&
      typeof item === "object" &&
      (
        item as Record<string, unknown>
      ).type === "message" &&
      Array.isArray(
        (
          item as Record<string, unknown>
        ).content,
      )
    ) {
      for (
        const part of (
          item as Record<string, unknown>
        ).content as unknown[]
      ) {
        if (
          part &&
          typeof part === "object" &&
          (
            part as Record<string, unknown>
          ).type === "output_text" &&
          typeof (
            part as Record<string, unknown>
          ).text === "string"
        ) {
          chunks.push(
            (
              part as Record<string, unknown>
            ).text as string,
          );
        }
      }
    }
  }

  return chunks
    .join("")
    .trim();
}

function buildRequestBody(
  messages: OpenAiMessage[],
  options: OpenAiRequestOptions,
  stream: boolean,
  provider: ActiveProviderConfig,
) {
  return JSON.stringify({
    model: provider.model,

    input: toResponsesInput(
      messages,
    ),

    max_output_tokens:
      options.maxOutputTokens ??
      (provider.provider === "GAMEVORTEX"
        ? gameVortexAiConfig.maxOutputTokens
        : openaiConfig.maxOutputTokens),

    reasoning: {
      effort:
        options.reasoningEffort ??
        (provider.provider === "GAMEVORTEX"
          ? gameVortexAiConfig.reasoningEffort
          : openaiConfig.reasoningEffort),
    },

    ...(stream
      ? { stream: true }
      : {}),
  });
}

function toNetworkOrTimeoutError(
  error: unknown,
  requestId: string,
  timeoutMs: number,
): OpenAiError {
  const isAbort =
    error instanceof Error &&
    (
      error.name === "AbortError" ||
      error.name === "TimeoutError"
    );

  if (isAbort) {
    return new OpenAiError(
      `AI request timed out after ${timeoutMs}ms`,
      "OPENAI_TIMEOUT",
      requestId,
    );
  }

  const message =
    error instanceof Error
      ? error.message
      : "UNKNOWN_ERROR";

  return new OpenAiError(
    message,
    "OPENAI_NETWORK_ERROR",
    requestId,
  );
}

/**
 * Creates the Authorization headers for the active provider.
 *
 * The API key is only ever read server-side.
 *
 * It is never returned from this module.
 */
function buildHeaders(
  provider: ActiveProviderConfig,
  stream: boolean,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (provider.apiKey) {
    headers.Authorization =
      `Bearer ${provider.apiKey}`;
  }

  if (stream) {
    headers.Accept =
      "text/event-stream";
  }

  return headers;
}

/**
 * Non-streaming request.
 *
 * When GameVortex AI is enabled, this request is sent to the
 * GameVortex self-hosted AI server.
 *
 * When GameVortex AI is not enabled, the existing OpenAI
 * endpoint is used.
 */
export async function openaiRespond(
  messages: OpenAiMessage[],
  options: OpenAiRequestOptions = {},
): Promise<OpenAiResult> {
  const requestId = randomUUID();

  const provider =
    getActiveProviderConfig(
      requestId,
    );

  const startedAt =
    Date.now();

  const timeoutMs =
    options.timeoutMs ??
    (provider.provider === "GAMEVORTEX"
      ? gameVortexAiConfig.timeoutMs
      : openaiConfig.timeoutMs);

  const controller =
    new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    timeoutMs,
  );

  try {
    const response =
      await fetch(
        `${provider.baseUrl}/responses`,
        {
          method: "POST",

          headers:
            buildHeaders(
              provider,
              false,
            ),

          body:
            buildRequestBody(
              messages,
              options,
              false,
              provider,
            ),

          signal:
            controller.signal,

          cache: "no-store",
        },
      );

    const providerRequestId =
      response.headers.get(
        "x-request-id",
      );

    if (!response.ok) {
      const {
        message,
        code,
      } =
        await parseErrorBody(
          response,
        );

      logEvent(
        "openai_error",
        {
          requestId,

          openaiRequestId:
            providerRequestId,

          model:
            provider.model,

          provider:
            provider.provider,

          httpStatus:
            response.status,

          providerCode:
            code,
        },
      );

      throw new OpenAiError(
        message,

        code
          ? mapProviderErrorCode(
              code,
              response.status,
            )
          : classifyStatus(
              response.status,
            ),

        requestId,

        response.status,
      );
    }

    const data: unknown =
      await response.json();

    const text =
      extractOutputText(
        data,
      );

    if (!text) {
      throw new OpenAiError(
        "Empty response from AI provider",
        "OPENAI_INVALID_RESPONSE",
        requestId,
      );
    }

    const latencyMs =
      Date.now() -
      startedAt;

    logEvent(
      "openai_success",
      {
        requestId,

        openaiRequestId:
          providerRequestId,

        model:
          provider.model,

        provider:
          provider.provider,

        latencyMs,
      },
    );

    return {
      text,

      requestId,

      openaiRequestId:
        providerRequestId,

      model:
        provider.model,

      latencyMs,
    };
  } catch (error) {
    if (
      error instanceof OpenAiError
    ) {
      throw error;
    }

    throw toNetworkOrTimeoutError(
      error,
      requestId,
      timeoutMs,
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Streaming request.
 *
 * The function name remains openaiRespondStream for backward
 * compatibility with the existing GameVortex chat route.
 *
 * The actual provider can now be:
 *
 * OPENAI
 * or
 * GAMEVORTEX
 */
export async function* openaiRespondStream(
  messages: OpenAiMessage[],
  options: OpenAiRequestOptions = {},
): AsyncGenerator<
  string,
  void,
  unknown
> {
  const requestId =
    randomUUID();

  const provider =
    getActiveProviderConfig(
      requestId,
    );

  const startedAt =
    Date.now();

  const timeoutMs =
    options.timeoutMs ??
    (provider.provider === "GAMEVORTEX"
      ? gameVortexAiConfig.timeoutMs
      : openaiConfig.timeoutMs);

  const controller =
    new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    timeoutMs,
  );

  try {
    const response =
      await fetch(
        `${provider.baseUrl}/responses`,
        {
          method: "POST",

          headers:
            buildHeaders(
              provider,
              true,
            ),

          body:
            buildRequestBody(
              messages,
              options,
              true,
              provider,
            ),

          signal:
            controller.signal,

          cache: "no-store",
        },
      );

    const providerRequestId =
      response.headers.get(
        "x-request-id",
      );

    if (
      !response.ok ||
      !response.body
    ) {
      const {
        message,
        code,
      } =
        await parseErrorBody(
          response,
        );

      logEvent(
        "openai_error",
        {
          requestId,

          openaiRequestId:
            providerRequestId,

          model:
            provider.model,

          provider:
            provider.provider,

          httpStatus:
            response.status,

          providerCode:
            code,
        },
      );

      throw new OpenAiError(
        message,

        code
          ? mapProviderErrorCode(
              code,
              response.status,
            )
          : classifyStatus(
              response.status,
            ),

        requestId,

        response.status,
      );
    }

    const reader =
      response.body.getReader();

    const decoder =
      new TextDecoder();

    let buffer = "";
    let outputLength = 0;

    while (true) {
      const {
        done,
        value,
      } =
        await reader.read();

      if (done) {
        break;
      }

      buffer +=
        decoder.decode(
          value,
          {
            stream: true,
          },
        );

      const lines =
        buffer.split("\n");

      buffer =
        lines.pop() ?? "";

      for (
        const line of lines
      ) {
        const trimmed =
          line.trim();

        if (
          !trimmed.startsWith(
            "data:",
          )
        ) {
          continue;
        }

        const payload =
          trimmed
            .slice(5)
            .trim();

        if (
          !payload ||
          payload === "[DONE]"
        ) {
          continue;
        }

        let event: unknown;

        try {
          event =
            JSON.parse(
              payload,
            );
        } catch {
          continue;
        }

        if (
          !event ||
          typeof event !==
            "object"
        ) {
          continue;
        }

        const eventType =
          (
            event as Record<
              string,
              unknown
            >
          ).type;

        if (
          eventType ===
            "response.output_text.delta" &&
          typeof (
            event as Record<
              string,
              unknown
            >
          ).delta === "string"
        ) {
          const delta =
            (
              event as Record<
                string,
                unknown
              >
            ).delta as string;

          outputLength +=
            delta.length;

          yield delta;
        } else if (
          eventType ===
            "response.failed" ||
          eventType ===
            "response.error" ||
          eventType === "error"
        ) {
          const {
            message,
            code,
          } =
            extractStreamEventError(
              event as Record<
                string,
                unknown
              >,
            );

          logEvent(
            "openai_error",
            {
              requestId,

              openaiRequestId:
                providerRequestId,

              model:
                provider.model,

              provider:
                provider.provider,

              eventType,

              providerCode:
                code,
            },
          );

          throw new OpenAiError(
            message,

            mapProviderErrorCode(
              code,
            ),

            requestId,
          );
        }
      }
    }

    const latencyMs =
      Date.now() -
      startedAt;

    logEvent(
      "openai_success",
      {
        requestId,

        openaiRequestId:
          providerRequestId,

        model:
          provider.model,

        provider:
          provider.provider,

        latencyMs,

        stream: true,

        outputLength,
      },
    );
  } catch (error) {
    if (
      error instanceof OpenAiError
    ) {
      throw error;
    }

    throw toNetworkOrTimeoutError(
      error,
      requestId,
      timeoutMs,
    );
  } finally {
    clearTimeout(timer);
  }
}
