import { randomUUID } from "node:crypto";

import { logEvent } from "@/lib/observability";

import { openaiConfig, type ReasoningEffort } from "./config";

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
 * All errors thrown by this module are OpenAiError instances.
 * `requestId` is our own internal id (safe to log/show to the
 * user for support purposes) — it is never the API key.
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

function getKey(requestId: string): string {
  const key = process.env.OPENAI_API_KEY;

  if (!key) {
    throw new OpenAiError(
      "OPENAI_API_KEY is not configured",
      "OPENAI_NOT_CONFIGURED",
      requestId,
    );
  }

  return key;
}

function classifyStatus(status: number): OpenAiErrorCode {
  if (status === 401 || status === 403) return "OPENAI_UNAUTHORIZED";
  if (status === 429) return "OPENAI_RATE_LIMITED";
  if (status >= 500) return "OPENAI_SERVER_ERROR";
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
          : "OPENAI_ERROR",
      code: typeof code === "string" ? code : null,
    };
  } catch {
    return { message: "OPENAI_ERROR", code: null };
  }
}

/**
 * Maps an OpenAI-declared error `code` (and, as a fallback, the HTTP
 * status) to one of our internal OpenAiErrorCode values. This is what
 * decides both the HTTP status we return to the client and the public
 * error string (see toPublicError() in the chat route) — so getting
 * this right is what stops every failure from collapsing into the
 * generic "AI_PROVIDER_ERROR" message.
 */
function mapProviderErrorCode(
  rawCode: string | null | undefined,
  httpStatus?: number,
): OpenAiErrorCode {
  const code = (rawCode ?? "").toLowerCase();

  if (
    httpStatus === 401 ||
    httpStatus === 403 ||
    code.includes("api_key") ||
    code.includes("unauthorized") ||
    code.includes("permission")
  ) {
    return "OPENAI_UNAUTHORIZED";
  }

  if (
    httpStatus === 429 ||
    code.includes("rate_limit") ||
    code.includes("quota")
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

  if (httpStatus !== undefined && httpStatus >= 500) {
    return "OPENAI_SERVER_ERROR";
  }

  // No HTTP status (mid-stream failure) and an unrecognized/missing
  // code: default to a server-side classification rather than
  // silently mislabeling a client-side problem as ours.
  return "OPENAI_SERVER_ERROR";
}

/**
 * Extracts the real error out of a mid-stream SSE event.
 *
 * The Responses API reports failures in three different shapes:
 *   - `response.failed`  -> error lives at event.response.error
 *   - `response.error`   -> error lives at event.error
 *   - `error`            -> error lives at event.error, or sometimes
 *                           as a bare top-level event.message
 *
 * The previous implementation only ever looked at `event.error`,
 * which is `undefined` for `response.failed` (the most common
 * failure event), so every such failure fell through to the generic
 * "OPENAI_STREAM_FAILED" placeholder instead of the model's, or
 * OpenAI's, actual error message.
 */
function extractStreamEventError(
  event: Record<string, unknown>,
): ProviderError {
  const response = event.response;

  if (response && typeof response === "object") {
    const responseError = (response as Record<string, unknown>)
      .error;

    if (responseError && typeof responseError === "object") {
      const message = (responseError as Record<string, unknown>)
        .message;
      const code = (responseError as Record<string, unknown>).code;

      if (typeof message === "string") {
        return {
          message: message.slice(0, 500),
          code: typeof code === "string" ? code : null,
        };
      }
    }
  }

  const directError = event.error;

  if (directError && typeof directError === "object") {
    const message = (directError as Record<string, unknown>)
      .message;
    const code = (directError as Record<string, unknown>).code;

    if (typeof message === "string") {
      return {
        message: message.slice(0, 500),
        code: typeof code === "string" ? code : null,
      };
    }
  }

  const topLevelMessage = event.message;

  if (typeof topLevelMessage === "string") {
    return {
      message: topLevelMessage.slice(0, 500),
      code: null,
    };
  }

  return { message: "OPENAI_STREAM_FAILED", code: null };
}

function toResponsesInput(messages: OpenAiMessage[]) {
  return messages.map((message) => ({
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
  }));
}

function extractOutputText(data: unknown): string {
  if (
    data &&
    typeof data === "object" &&
    "output_text" in data &&
    typeof (data as Record<string, unknown>).output_text === "string"
  ) {
    return (data as Record<string, unknown>).output_text as string;
  }

  const output =
    data &&
    typeof data === "object" &&
    "output" in data &&
    Array.isArray((data as Record<string, unknown>).output)
      ? ((data as Record<string, unknown>).output as unknown[])
      : [];

  const chunks: string[] = [];

  for (const item of output) {
    if (
      item &&
      typeof item === "object" &&
      (item as Record<string, unknown>).type === "message" &&
      Array.isArray((item as Record<string, unknown>).content)
    ) {
      for (const part of (item as Record<string, unknown>)
        .content as unknown[]) {
        if (
          part &&
          typeof part === "object" &&
          (part as Record<string, unknown>).type === "output_text" &&
          typeof (part as Record<string, unknown>).text === "string"
        ) {
          chunks.push((part as Record<string, unknown>).text as string);
        }
      }
    }
  }

  return chunks.join("").trim();
}

function buildRequestBody(
  messages: OpenAiMessage[],
  options: OpenAiRequestOptions,
  stream: boolean,
) {
  return JSON.stringify({
    model: openaiConfig.model,
    input: toResponsesInput(messages),
    max_output_tokens:
      options.maxOutputTokens ?? openaiConfig.maxOutputTokens,
    reasoning: {
      effort: options.reasoningEffort ?? openaiConfig.reasoningEffort,
    },
    ...(stream ? { stream: true } : {}),
  });
}

function toNetworkOrTimeoutError(
  error: unknown,
  requestId: string,
  timeoutMs: number,
): OpenAiError {
  const isAbort = error instanceof Error && error.name === "AbortError";

  if (isAbort) {
    return new OpenAiError(
      `OpenAI request timed out after ${timeoutMs}ms`,
      "OPENAI_TIMEOUT",
      requestId,
    );
  }

  const message =
    error instanceof Error ? error.message : "UNKNOWN_ERROR";

  return new OpenAiError(
    message,
    "OPENAI_NETWORK_ERROR",
    requestId,
  );
}

/**
 * Non-streaming call to the OpenAI Responses API.
 *
 * Never logs the API key or message content — only ids, the
 * model name, status codes, and latency.
 */
export async function openaiRespond(
  messages: OpenAiMessage[],
  options: OpenAiRequestOptions = {},
): Promise<OpenAiResult> {
  const requestId = randomUUID();
  const key = getKey(requestId);
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? openaiConfig.timeoutMs;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${openaiConfig.baseUrl}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: buildRequestBody(messages, options, false),
      signal: controller.signal,
      cache: "no-store",
    });

    const openaiRequestId = response.headers.get("x-request-id");

    if (!response.ok) {
      const { message, code } = await parseErrorBody(response);

      logEvent("openai_error", {
        requestId,
        openaiRequestId,
        model: openaiConfig.model,
        httpStatus: response.status,
        providerCode: code,
      });

      throw new OpenAiError(
        message,
        code
          ? mapProviderErrorCode(code, response.status)
          : classifyStatus(response.status),
        requestId,
        response.status,
      );
    }

    const data: unknown = await response.json();
    const text = extractOutputText(data);

    if (!text) {
      throw new OpenAiError(
        "Empty response from OpenAI",
        "OPENAI_INVALID_RESPONSE",
        requestId,
      );
    }

    const latencyMs = Date.now() - startedAt;

    logEvent("openai_success", {
      requestId,
      openaiRequestId,
      model: openaiConfig.model,
      latencyMs,
    });

    return {
      text,
      requestId,
      openaiRequestId,
      model: openaiConfig.model,
      latencyMs,
    };
  } catch (error) {
    if (error instanceof OpenAiError) throw error;
    throw toNetworkOrTimeoutError(error, requestId, timeoutMs);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Streaming call to the OpenAI Responses API.
 * Yields plain-text deltas as they arrive from the model.
 *
 * Usage:
 *   for await (const delta of openaiRespondStream(messages)) {
 *     // forward `delta` to the client (e.g. over SSE)
 *   }
 */
export async function* openaiRespondStream(
  messages: OpenAiMessage[],
  options: OpenAiRequestOptions = {},
): AsyncGenerator<string, void, unknown> {
  const requestId = randomUUID();
  const key = getKey(requestId);
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? openaiConfig.timeoutMs;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${openaiConfig.baseUrl}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: buildRequestBody(messages, options, true),
      signal: controller.signal,
      cache: "no-store",
    });

    const openaiRequestId = response.headers.get("x-request-id");

    if (!response.ok || !response.body) {
      const { message, code } = await parseErrorBody(response);

      logEvent("openai_error", {
        requestId,
        openaiRequestId,
        model: openaiConfig.model,
        httpStatus: response.status,
        providerCode: code,
      });

      throw new OpenAiError(
        message,
        code
          ? mapProviderErrorCode(code, response.status)
          : classifyStatus(response.status),
        requestId,
        response.status,
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let buffer = "";
    let outputLength = 0;

    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();

        if (!trimmed.startsWith("data:")) continue;

        const payload = trimmed.slice(5).trim();

        if (!payload || payload === "[DONE]") continue;

        let event: unknown;

        try {
          event = JSON.parse(payload);
        } catch {
          // Ignore malformed/partial SSE chunks.
          continue;
        }

        if (!event || typeof event !== "object") continue;

        const eventType = (event as Record<string, unknown>).type;

        if (
          eventType === "response.output_text.delta" &&
          typeof (event as Record<string, unknown>).delta === "string"
        ) {
          const delta = (event as Record<string, unknown>)
            .delta as string;

          outputLength += delta.length;

          yield delta;
        } else if (
          eventType === "response.failed" ||
          eventType === "response.error" ||
          eventType === "error"
        ) {
          const { message, code } = extractStreamEventError(
            event as Record<string, unknown>,
          );

          logEvent("openai_error", {
            requestId,
            openaiRequestId,
            model: openaiConfig.model,
            eventType,
            providerCode: code,
          });

          throw new OpenAiError(
            message,
            mapProviderErrorCode(code),
            requestId,
          );
        }
      }
    }

    const latencyMs = Date.now() - startedAt;

    logEvent("openai_success", {
      requestId,
      openaiRequestId,
      model: openaiConfig.model,
      latencyMs,
      stream: true,
      outputLength,
    });
  } catch (error) {
    if (error instanceof OpenAiError) throw error;
    throw toNetworkOrTimeoutError(error, requestId, timeoutMs);
  } finally {
    clearTimeout(timer);
  }
}
