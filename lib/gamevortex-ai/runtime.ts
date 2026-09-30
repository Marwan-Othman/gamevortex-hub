/**
 * GameVortex AI Runtime
 *
 * Provider:
 * Google Gemini API
 *
 * Environment:
 * GEMINI_API_KEY
 * GEMINI_MODEL (optional)
 *
 * This runtime replaces the old Ollama runtime while keeping
 * the existing GameVortex AI chat streaming contract compatible.
 */

export type GameVortexAIMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type GameVortexAIRuntimeOptions = {
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
};

export type GameVortexAIResult = {
  text: string;
  model: string;
};

const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models";

const DEFAULT_MODEL =
  process.env.GEMINI_MODEL?.trim() ||
  "gemini-3.8-flash";

const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_MAX_OUTPUT_TOKENS = 2000;

const MAX_MESSAGE_LENGTH = 4000;
const MAX_MESSAGES = 50;

function getGeminiApiKey(): string {
  const apiKey =
    process.env.GEMINI_API_KEY?.trim();

  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not configured.",
    );
  }

  return apiKey;
}

function cleanText(
  value: unknown,
  maxLength = MAX_MESSAGE_LENGTH,
): string {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,
      "",
    )
    .trim()
    .slice(0, maxLength);
}

function normalizeMessages(
  messages: GameVortexAIMessage[],
): GameVortexAIMessage[] {
  return messages
    .filter(
      (message) =>
        message &&
        (
          message.role === "system" ||
          message.role === "user" ||
          message.role === "assistant"
        ),
    )
    .map((message) => ({
      role: message.role,
      content: cleanText(
        message.content,
        MAX_MESSAGE_LENGTH,
      ),
    }))
    .filter(
      (message) =>
        message.content.length > 0,
    )
    .slice(-MAX_MESSAGES);
}

function convertRole(
  role: GameVortexAIMessage["role"],
): "user" | "model" {
  return role === "assistant"
    ? "model"
    : "user";
}

function buildGeminiRequest(
  messages: GameVortexAIMessage[],
  options: GameVortexAIRuntimeOptions,
) {
  const normalized =
    normalizeMessages(messages);

  if (normalized.length === 0) {
    throw new Error(
      "AI_EMPTY_INPUT",
    );
  }

  const systemMessages =
    normalized.filter(
      (message) =>
        message.role === "system",
    );

  const conversationMessages =
    normalized.filter(
      (message) =>
        message.role !== "system",
    );

  const systemText =
    systemMessages
      .map(
        (message) =>
          message.content,
      )
      .join("\n\n")
      .trim();

  const contents =
    conversationMessages.map(
      (message) => ({
        role: convertRole(
          message.role,
        ),
        parts: [
          {
            text: message.content,
          },
        ],
      }),
    );

  return {
    ...(systemText
      ? {
          systemInstruction: {
            parts: [
              {
                text: systemText,
              },
            ],
          },
        }
      : {}),

    contents,

    generationConfig: {
      temperature:
        typeof options.temperature ===
        "number"
          ? Math.max(
              0,
              Math.min(
                options.temperature,
                2,
              ),
            )
          : DEFAULT_TEMPERATURE,

      maxOutputTokens:
        typeof options.maxOutputTokens ===
        "number"
          ? Math.max(
              1,
              Math.min(
                Math.floor(
                  options.maxOutputTokens,
                ),
                8192,
              ),
            )
          : DEFAULT_MAX_OUTPUT_TOKENS,
    },
  };
}

function extractText(
  data: unknown,
): string {
  if (
    !data ||
    typeof data !== "object"
  ) {
    return "";
  }

  const response =
    data as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            text?: unknown;
          }>;
        };
      }>;
    };

  const candidates =
    Array.isArray(
      response.candidates,
    )
      ? response.candidates
      : [];

  let text = "";

  for (const candidate of candidates) {
    const parts =
      candidate.content?.parts;

    if (!Array.isArray(parts)) {
      continue;
    }

    for (const part of parts) {
      if (
        typeof part.text ===
        "string"
      ) {
        text += part.text;
      }
    }
  }

  return text;
}

async function parseGeminiError(
  response: Response,
): Promise<string> {
  let body: unknown = null;

  try {
    body = await response.json();
  } catch {
    try {
      body = await response.text();
    } catch {
      body = null;
    }
  }

  if (
    body &&
    typeof body === "object" &&
    "error" in body
  ) {
    const error =
      (
        body as {
          error?: {
            message?: unknown;
          };
        }
      ).error;

    if (
      error &&
      typeof error.message ===
        "string"
    ) {
      return error.message;
    }
  }

  if (
    typeof body === "string" &&
    body.trim()
  ) {
    return body.trim().slice(0, 1000);
  }

  return `Gemini API request failed with status ${response.status}.`;
}

/**
 * Non-streaming Gemini response.
 */
export async function runGameVortexAI(
  messages: GameVortexAIMessage[],
  options: GameVortexAIRuntimeOptions = {},
): Promise<GameVortexAIResult> {
  const apiKey =
    getGeminiApiKey();

  const model =
    options.model?.trim() ||
    DEFAULT_MODEL;

  const requestBody =
    buildGeminiRequest(
      messages,
      options,
    );

  const response =
    await fetch(
      `${GEMINI_API_URL}/${encodeURIComponent(
        model,
      )}:generateContent`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",
          "x-goog-api-key":
            apiKey,
        },

        body: JSON.stringify(
          requestBody,
        ),

        signal:
          options.signal,

        cache: "no-store",
      },
    );

  if (!response.ok) {
    const error =
      await parseGeminiError(
        response,
      );

    throw new Error(
      `Gemini API error: ${error}`,
    );
  }

  const data: unknown =
    await response.json();

  const text =
    extractText(data)
      .trim();

  if (!text) {
    throw new Error(
      "Gemini returned an empty response.",
    );
  }

  return {
    text,
    model,
  };
}

/**
 * Streaming Gemini response.
 *
 * Gemini returns Server-Sent Events.
 * This function converts those events into
 * plain text chunks so the existing GameVortex
 * chat layer can continue streaming normally.
 */
export async function* streamGameVortexAI(
  messages: GameVortexAIMessage[],
  options: GameVortexAIRuntimeOptions = {},
): AsyncGenerator<
  string,
  void,
  unknown
> {
  const apiKey =
    getGeminiApiKey();

  const model =
    options.model?.trim() ||
    DEFAULT_MODEL;

  const requestBody =
    buildGeminiRequest(
      messages,
      options,
    );

  const response =
    await fetch(
      `${GEMINI_API_URL}/${encodeURIComponent(
        model,
      )}:streamGenerateContent?alt=sse`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",
          "x-goog-api-key":
            apiKey,
          Accept:
            "text/event-stream",
        },

        body: JSON.stringify(
          requestBody,
        ),

        signal:
          options.signal,

        cache: "no-store",
      },
    );

  if (!response.ok) {
    const error =
      await parseGeminiError(
        response,
      );

    throw new Error(
      `Gemini API error: ${error}`,
    );
  }

  if (!response.body) {
    throw new Error(
      "Gemini returned no streaming body.",
    );
  }

  const reader =
    response.body.getReader();

  const decoder =
    new TextDecoder();

  let buffer = "";

  try {
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

      const events =
        buffer.split(
          "\n\n",
        );

      buffer =
        events.pop() ?? "";

      for (
        const eventBlock of events
      ) {
        const lines =
          eventBlock.split(
            "\n",
          );

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

          if (!payload) {
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

          const chunk =
            extractText(
              event,
            );

          if (chunk) {
            yield chunk;
          }
        }
      }
    }

    /*
     * Flush any final decoder data.
     */
    buffer +=
      decoder.decode();

    if (buffer.trim()) {
      const lines =
        buffer.split(
          "\n",
        );

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

        if (!payload) {
          continue;
        }

        try {
          const event =
            JSON.parse(
              payload,
            );

          const chunk =
            extractText(
              event,
            );

          if (chunk) {
            yield chunk;
          }
        } catch {
          // Ignore incomplete final SSE data.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Compatibility aliases.
 *
 * These allow existing GameVortex AI callers
 * to use the new Gemini runtime without
 * changing their naming conventions.
 */
export const gameVortexAI =
  runGameVortexAI;

export const gameVortexAIStream =
  streamGameVortexAI;

export const aiRuntime =
  runGameVortexAI;

export const aiRuntimeStream =
  streamGameVortexAI;
