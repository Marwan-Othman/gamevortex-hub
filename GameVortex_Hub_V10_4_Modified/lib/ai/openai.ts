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

async function parseErrorBody(response: Response): Promise<string> {
  try {
    const data: unknown = await response.json();
    const message =
      data &&
      typeof data === "object" &&
      "error" in data &&
      data.error &&
      typeof data.error === "object" &&
      "message" in data.error
        ? (data.error as Record<string, unknown>).message
        : null;

    return typeof message === "string"
      ? message.slice(0, 500)
      : "OPENAI_ERROR";
  } catch {
    return "OPENAI_ERROR";
  }
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
      const message = await parseErrorBody(response);

      throw new OpenAiError(
        message,
        classifyStatus(response.status),
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
      const message = await parseErrorBody(response);

      throw new OpenAiError(
        message,
        classifyStatus(response.status),
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
          eventType === "error"
        ) {
          const failure = event as Record<string, unknown>;

          const nestedError =
            failure.error &&
            typeof failure.error === "object"
              ? (failure.error as Record<string, unknown>).message
              : null;

          throw new OpenAiError(
            String(nestedError ?? "OPENAI_STREAM_FAILED").slice(
              0,
              500,
            ),
            "OPENAI_SERVER_ERROR",
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
