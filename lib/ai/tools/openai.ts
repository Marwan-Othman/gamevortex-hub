import { randomUUID } from "node:crypto";

import { logEvent } from "@/lib/observability";

import {
  openaiConfig,
  type ReasoningEffort,
} from "@/lib/ai/config";

import {
  OpenAiError,
  type OpenAiMessage,
} from "@/lib/ai/openai";

/* =========================================================
 * TYPES
 * ======================================================= */

type OpenAiToolDefinition = {
  type: "function";
  name: string;
  description: string;
  strict: true;
  parameters: Record<string, unknown>;
};

type OpenAiFunctionCall = {
  type: "function_call";
  id?: string;
  call_id: string;
  name: string;
  arguments: string;
};

type OpenAiResponse = {
  id?: string;
  output?: unknown[];
  output_text?: string;
};

export type GameVortexToolChatOptions = {
  maxOutputTokens?: number;
  reasoningEffort?: ReasoningEffort;
  timeoutMs?: number;

  /**
   * Maximum number of tool rounds allowed
   * for a single AI request.
   */
  maxToolRounds?: number;
};

export type GameVortexToolChatResult = {
  text: string;
  toolCalls: number;
  toolNames: string[];
  requestId: string;
  openaiRequestId: string | null;
  model: string;
  latencyMs: number;
};

/* =========================================================
 * LIMITS
 * ======================================================= */

const DEFAULT_MAX_TOOL_ROUNDS = 4;

const MAX_TOOL_CALLS = 8;

const MAX_TOOL_ARGUMENT_LENGTH = 20_000;

const MAX_TOOL_RESULT_LENGTH = 8_000;

const MAX_FINAL_OUTPUT_LENGTH = 20_000;

/* =========================================================
 * OPENAI TOOL DEFINITIONS
 * ======================================================= */

const TOOL_DEFINITIONS: Record<
  string,
  OpenAiToolDefinition
> = {
  searchGames: {
    type: "function",
    name: "searchGames",

    description:
      "Search published games in the GameVortex game catalog. Use this when the user asks about available games, games by name, genre, or platform.",

    strict: true,

    parameters: {
      type: "object",

      properties: {
        query: {
          type: "string",
          minLength: 1,
          maxLength: 100,
          description:
            "Game search query.",
        },

        platform: {
          type: [
            "string",
            "null",
          ],

          description:
            "Optional platform filter such as PC, PLAYSTATION, XBOX, NINTENDO, ANDROID, IOS, MAC, LINUX, STEAM_DECK, or WEB.",
        },

        genre: {
          type: [
            "string",
            "null",
          ],

          description:
            "Optional game genre.",
        },

        pagination: {
          type: [
            "object",
            "null",
          ],

          properties: {
            page: {
              type: "integer",
              minimum: 1,
              maximum: 1000,
            },

            limit: {
              type: "integer",
              minimum: 1,
              maximum: 25,
            },
          },

          required: [
            "page",
            "limit",
          ],

          additionalProperties: false,
        },
      },

      required: [
        "query",
        "platform",
        "genre",
        "pagination",
      ],

      additionalProperties: false,
    },
  },

  getGame: {
    type: "function",
    name: "getGame",

    description:
      "Get details about one published GameVortex game by its id or slug.",

    strict: true,

    parameters: {
      type: "object",

      properties: {
        id: {
          type: [
            "string",
            "null",
          ],

          description:
            "Game id.",
        },

        slug: {
          type: [
            "string",
            "null",
          ],

          description:
            "Game slug.",
        },
      },

      required: [
        "id",
        "slug",
      ],

      additionalProperties: false,
    },
  },

  getPlatformGames: {
    type: "function",
    name: "getPlatformGames",

    description:
      "Get published GameVortex games assigned to a specific gaming platform.",

    strict: true,

    parameters: {
      type: "object",

      properties: {
        platform: {
          type: "string",

          enum: [
            "PC",
            "PLAYSTATION",
            "XBOX",
            "NINTENDO",
            "ANDROID",
            "IOS",
            "MAC",
            "LINUX",
            "STEAM_DECK",
            "WEB",
          ],
        },

        pagination: {
          type: [
            "object",
            "null",
          ],

          properties: {
            page: {
              type: "integer",
              minimum: 1,
              maximum: 1000,
            },

            limit: {
              type: "integer",
              minimum: 1,
              maximum: 25,
            },
          },

          required: [
            "page",
            "limit",
          ],

          additionalProperties: false,
        },
      },

      required: [
        "platform",
        "pagination",
      ],

      additionalProperties: false,
    },
  },

  searchApps: {
    type: "function",
    name: "searchApps",

    description:
      "Search active GameVortex applications and digital products.",

    strict: true,

    parameters: {
      type: "object",

      properties: {
        query: {
          type: "string",
          minLength: 1,
          maxLength: 100,
        },

        platform: {
          type: [
            "string",
            "null",
          ],
        },

        region: {
          type: [
            "string",
            "null",
          ],
        },

        pagination: {
          type: [
            "object",
            "null",
          ],

          properties: {
            page: {
              type: "integer",
              minimum: 1,
              maximum: 1000,
            },

            limit: {
              type: "integer",
              minimum: 1,
              maximum: 25,
            },
          },

          required: [
            "page",
            "limit",
          ],

          additionalProperties: false,
        },
      },

      required: [
        "query",
        "platform",
        "region",
        "pagination",
      ],

      additionalProperties: false,
    },
  },

  searchMarketplace: {
    type: "function",
    name: "searchMarketplace",

    description:
      "Search active products available in the GameVortex Marketplace.",

    strict: true,

    parameters: {
      type: "object",

      properties: {
        query: {
          type: "string",
          minLength: 1,
          maxLength: 100,
        },

        kind: {
          type: [
            "string",
            "null",
          ],

          enum: [
            "GAME_KEY",
            "GIFT_CARD",
            "TOP_UP",
            "DLC",
            "SUBSCRIPTION",
            "DIGITAL_ITEM",
            null,
          ],
        },

        platform: {
          type: [
            "string",
            "null",
          ],
        },

        region: {
          type: [
            "string",
            "null",
          ],
        },

        pagination: {
          type: [
            "object",
            "null",
          ],

          properties: {
            page: {
              type: "integer",
              minimum: 1,
              maximum: 1000,
            },

            limit: {
              type: "integer",
              minimum: 1,
              maximum: 25,
            },
          },

          required: [
            "page",
            "limit",
          ],

          additionalProperties: false,
        },
      },

      required: [
        "query",
        "kind",
        "platform",
        "region",
        "pagination",
      ],

      additionalProperties: false,
    },
  },

  getProduct: {
    type: "function",
    name: "getProduct",

    description:
      "Get details about one active GameVortex Marketplace product by id or SKU.",

    strict: true,

    parameters: {
      type: "object",

      properties: {
        id: {
          type: [
            "string",
            "null",
          ],
        },

        sku: {
          type: [
            "string",
            "null",
          ],
        },
      },

      required: [
        "id",
        "sku",
      ],

      additionalProperties: false,
    },
  },

  searchLibrary: {
    type: "function",
    name: "searchLibrary",

    description:
      "Search only the authenticated user's own GameVortex game library.",

    strict: true,

    parameters: {
      type: "object",

      properties: {
        query: {
          type: [
            "string",
            "null",
          ],
        },

        status: {
          type: [
            "string",
            "null",
          ],

          enum: [
            "WANT",
            "PLAYING",
            "BEATEN",
            "ARCHIVED",
            null,
          ],
        },

        pagination: {
          type: [
            "object",
            "null",
          ],

          properties: {
            page: {
              type: "integer",
              minimum: 1,
              maximum: 1000,
            },

            limit: {
              type: "integer",
              minimum: 1,
              maximum: 25,
            },
          },

          required: [
            "page",
            "limit",
          ],

          additionalProperties: false,
        },
      },

      required: [
        "query",
        "status",
        "pagination",
      ],

      additionalProperties: false,
    },
  },
};

/* =========================================================
 * ENABLED TOOLS
 * ======================================================= */

function getEnabledToolDefinitions(): OpenAiToolDefinition[] {
  const registeredTools =
    new Set<string>([
      "searchGames",
      "getGame",
      "getPlatformGames",
      "searchApps",
      "searchMarketplace",
      "getProduct",
      "searchLibrary",
    ]);

  return Object.values(
    TOOL_DEFINITIONS,
  ).filter(
    (tool) =>
      registeredTools.has(
        tool.name,
      ),
  );
}

/* =========================================================
 * TOOL ARGUMENTS
 * ======================================================= */

function parseToolArguments(
  rawArguments: string,
): unknown {
  if (
    typeof rawArguments !==
      "string" ||
    rawArguments.length === 0
  ) {
    return {};
  }

  if (
    rawArguments.length >
    MAX_TOOL_ARGUMENT_LENGTH
  ) {
    throw new Error(
      "AI_TOOL_ARGUMENTS_TOO_LARGE",
    );
  }

  try {
    return JSON.parse(
      rawArguments,
    );
  } catch {
    throw new Error(
      "AI_TOOL_INVALID_ARGUMENTS",
    );
  }
}

/* =========================================================
 * TOOL RESULT SERIALIZATION
 * ======================================================= */

function serializeToolResult(
  value: unknown,
): string {
  let serialized: string;

  try {
    serialized =
      JSON.stringify(
        value,
      );
  } catch {
    serialized =
      JSON.stringify({
        ok: false,

        error: {
          code:
            "AI_TOOL_RESULT_SERIALIZATION_FAILED",
        },
      });
  }

  if (
    serialized.length <=
    MAX_TOOL_RESULT_LENGTH
  ) {
    return serialized;
  }

  return JSON.stringify({
    ok: false,

    error: {
      code:
        "AI_TOOL_RESULT_TOO_LARGE",

      message:
        "The tool returned more data than the AI context allows.",
    },
  });
}

/* =========================================================
 * OUTPUT TEXT
 * ======================================================= */

function extractOutputText(
  response: OpenAiResponse,
): string {
  if (
    typeof response.output_text ===
    "string"
  ) {
    return response.output_text.trim();
  }

  const output =
    Array.isArray(
      response.output,
    )
      ? response.output
      : [];

  const chunks: string[] = [];

  for (
    const item of output
  ) {
    if (
      !item ||
      typeof item !==
        "object"
    ) {
      continue;
    }

    const record =
      item as Record<
        string,
        unknown
      >;

    if (
      record.type !==
        "message" ||
      !Array.isArray(
        record.content,
      )
    ) {
      continue;
    }

    for (
      const part of
        record.content
    ) {
      if (
        !part ||
        typeof part !==
          "object"
      ) {
        continue;
      }

      const content =
        part as Record<
          string,
          unknown
        >;

      if (
        content.type ===
          "output_text" &&
        typeof content.text ===
          "string"
      ) {
        chunks.push(
          content.text,
        );
      }
    }
  }

  return chunks
    .join("")
    .trim();
}

/* =========================================================
 * FUNCTION CALL EXTRACTION
 * ======================================================= */

function extractFunctionCalls(
  response: OpenAiResponse,
): OpenAiFunctionCall[] {
  const output =
    Array.isArray(
      response.output,
    )
      ? response.output
      : [];

  return output.filter(
    (
      item,
    ): item is OpenAiFunctionCall =>
      Boolean(
        item &&
        typeof item ===
          "object" &&
        (item as Record<
          string,
          unknown
        >).type ===
          "function_call" &&
        typeof (
          item as Record<
            string,
            unknown
          >
        ).call_id ===
          "string" &&
        typeof (
          item as Record<
            string,
            unknown
          >
        ).name ===
          "string" &&
        typeof (
          item as Record<
            string,
            unknown
          >
        ).arguments ===
          "string",
      ),
  );
}

/* =========================================================
 * MESSAGE CONVERSION
 * ======================================================= */

function toResponsesInput(
  messages: OpenAiMessage[],
) {
  return messages.map(
    (message) => ({
      role:
        message.role,

      content: [
        {
          type:
            message.role ===
            "assistant"
              ? "output_text"
              : "input_text",

          text:
            message.content,
        },
      ],
    }),
  );
}

/* =========================================================
 * OPENAI REQUEST
 * ======================================================= */

async function requestOpenAi(
  input: unknown[],
  options: GameVortexToolChatOptions,
): Promise<{
  response: OpenAiResponse;
  requestId: string;
  openaiRequestId: string | null;
  latencyMs: number;
}> {
  /*
   * IMPORTANT:
   *
   * Explicit `string` annotation prevents TypeScript from
   * preserving the UUID template-literal type returned by
   * randomUUID().
   *
   * This fixes the Vercel TS2322 error.
   */
  const requestId: string =
    randomUUID();

  const apiKey =
    process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new OpenAiError(
      "OPENAI_API_KEY is not configured",
      "OPENAI_NOT_CONFIGURED",
      requestId,
    );
  }

  const timeoutMs =
    options.timeoutMs ??
    openaiConfig.timeoutMs;

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => {
        controller.abort();
      },
      timeoutMs,
    );

  const startedAt =
    Date.now();

  try {
    const response =
      await fetch(
        `${openaiConfig.baseUrl}/responses`,
        {
          method: "POST",

          headers: {
            Authorization:
              `Bearer ${apiKey}`,

            "Content-Type":
              "application/json",
          },

          body:
            JSON.stringify({
              model:
                openaiConfig.model,

              input,

              tools:
                getEnabledToolDefinitions(),

              max_output_tokens:
                options.maxOutputTokens ??
                openaiConfig.maxOutputTokens,

              reasoning: {
                effort:
                  options.reasoningEffort ??
                  openaiConfig.reasoningEffort,
              },
            }),

          signal:
            controller.signal,

          cache:
            "no-store",
        },
      );

    const openaiRequestId =
      response.headers.get(
        "x-request-id",
      );

    if (!response.ok) {
      let message =
        "OpenAI request failed.";

      try {
        const body =
          (await response.json()) as {
            error?: {
              message?: string;
            };
          };

        if (
          typeof body?.error
            ?.message ===
          "string"
        ) {
          message =
            body.error.message.slice(
              0,
              500,
            );
        }
      } catch {
        // Keep generic message.
      }

      const code =
        response.status ===
          401 ||
        response.status ===
          403
          ? "OPENAI_UNAUTHORIZED"
          : response.status ===
              429
            ? "OPENAI_RATE_LIMITED"
            : response.status >=
                500
              ? "OPENAI_SERVER_ERROR"
              : "OPENAI_BAD_REQUEST";

      throw new OpenAiError(
        message,
        code,
        requestId,
        response.status,
      );
    }

    const data =
      (await response.json()) as OpenAiResponse;

    return {
      response:
        data,

      requestId,

      openaiRequestId,

      latencyMs:
        Date.now() -
        startedAt,
    };
  } catch (error) {
    if (
      error instanceof
      OpenAiError
    ) {
      throw error;
    }

    if (
      error instanceof
        Error &&
      error.name ===
        "AbortError"
    ) {
      throw new OpenAiError(
        `OpenAI request timed out after ${timeoutMs}ms`,
        "OPENAI_TIMEOUT",
        requestId,
      );
    }

    throw new OpenAiError(
      error instanceof
        Error
        ? error.message
        : "OPENAI_NETWORK_ERROR",

      "OPENAI_NETWORK_ERROR",

      requestId,
    );
  } finally {
    clearTimeout(
      timeout,
    );
  }
}

/* =========================================================
 * TOOL EXECUTION
 * ======================================================= */

async function executeFunctionCalls(
  calls: OpenAiFunctionCall[],
) {
  const outputs: Array<{
    type:
      "function_call_output";

    call_id: string;

    output: string;
  }> = [];

  const toolNames: string[] = [];

  for (
    const call of calls
  ) {
    toolNames.push(
      call.name,
    );

    let parsedArguments:
      unknown;

    try {
      parsedArguments =
        parseToolArguments(
          call.arguments,
        );
    } catch (error) {
      outputs.push({
        type:
          "function_call_output",

        call_id:
          call.call_id,

        output:
          serializeToolResult({
            ok: false,

            error: {
              code:
                error instanceof
                Error
                  ? error.message
                  : "AI_TOOL_ARGUMENT_ERROR",
            },
          }),
      });

      continue;
    }

    try {
      /*
       * IMPORTANT:
       *
       * The model never receives Prisma access.
       *
       * All tool execution goes through the central
       * GameVortex registry.
       */
      const {
        executeAiTool,
      } = await import(
        "./registry"
      );

      const result =
        await executeAiTool(
          call.name,
          parsedArguments,
        );

      outputs.push({
        type:
          "function_call_output",

        call_id:
          call.call_id,

        output:
          serializeToolResult(
            result,
          ),
      });
    } catch (error) {
      outputs.push({
        type:
          "function_call_output",

        call_id:
          call.call_id,

        output:
          serializeToolResult({
            ok: false,

            error: {
              code:
                error instanceof
                Error
                  ? error.message
                  : "AI_TOOL_EXECUTION_FAILED",
            },
          }),
      });
    }
  }

  return {
    outputs,
    toolNames,
  };
}

/* =========================================================
 * MAIN GAMEVORTEX TOOL CHAT
 * ======================================================= */

export async function aiChatWithGameVortexTools(
  messages: OpenAiMessage[],
  options: GameVortexToolChatOptions = {},
): Promise<GameVortexToolChatResult> {
  const startedAt =
    Date.now();

  const maxToolRounds =
    Math.min(
      Math.max(
        options.maxToolRounds ??
          DEFAULT_MAX_TOOL_ROUNDS,

        1,
      ),

      DEFAULT_MAX_TOOL_ROUNDS,
    );

  const tools =
    getEnabledToolDefinitions();

  if (
    tools.length ===
    0
  ) {
    const requestId: string =
      randomUUID();

    throw new OpenAiError(
      "No GameVortex AI tools are registered.",

      "OPENAI_INVALID_RESPONSE",

      requestId,
    );
  }

  let input: unknown[] =
    toResponsesInput(
      messages,
    );

  let totalToolCalls =
    0;

  const usedToolNames =
    new Set<string>();

  /*
   * Explicit string annotation is important.
   *
   * randomUUID() returns a UUID template-literal type,
   * while OpenAiResult.requestId is intentionally a string.
   */
  let lastRequestId: string =
    randomUUID();

  let lastOpenAiRequestId:
    | string
    | null =
    null;

  let lastModel: string =
    openaiConfig.model;

  for (
    let round = 0;
    round < maxToolRounds;
    round++
  ) {
    const request =
      await requestOpenAi(
        input,
        options,
      );

    /*
     * Explicit String conversion keeps this assignment
     * compatible even if the provider implementation later
     * changes the inferred requestId type.
     */
    lastRequestId =
      String(
        request.requestId,
      );

    lastOpenAiRequestId =
      request.openaiRequestId;

    lastModel =
      openaiConfig.model;

    const functionCalls =
      extractFunctionCalls(
        request.response,
      );

    /*
     * No tool call means the model has produced
     * the final answer.
     */
    if (
      functionCalls.length ===
      0
    ) {
      const text =
        extractOutputText(
          request.response,
        );

      if (!text) {
        throw new OpenAiError(
          "GameVortex AI returned an empty response.",

          "OPENAI_INVALID_RESPONSE",

          String(
            request.requestId,
          ),
        );
      }

      const finalText =
        text.slice(
          0,
          MAX_FINAL_OUTPUT_LENGTH,
        );

      logEvent(
        "gamevortex_ai_tools_success",
        {
          requestId:
            String(
              request.requestId,
            ),

          openaiRequestId:
            request.openaiRequestId,

          model:
            openaiConfig.model,

          toolCalls:
            totalToolCalls,

          toolNames:
            Array.from(
              usedToolNames,
            ),

          latencyMs:
            Date.now() -
            startedAt,
        },
      );

      return {
        text:
          finalText,

        toolCalls:
          totalToolCalls,

        toolNames:
          Array.from(
            usedToolNames,
          ),

        requestId:
          String(
            request.requestId,
          ),

        openaiRequestId:
          request.openaiRequestId,

        model:
          lastModel,

        latencyMs:
          Date.now() -
          startedAt,
      };
    }

    totalToolCalls +=
      functionCalls.length;

    /*
     * Global protection against a model repeatedly
     * calling tools in one request.
     */
    if (
      totalToolCalls >
      MAX_TOOL_CALLS
    ) {
      throw new OpenAiError(
        "GameVortex AI exceeded the maximum number of tool calls.",

        "OPENAI_BAD_REQUEST",

        String(
          request.requestId,
        ),
      );
    }

    const execution =
      await executeFunctionCalls(
        functionCalls,
      );

    for (
      const name of
        execution.toolNames
    ) {
      usedToolNames.add(
        name,
      );
    }

    /*
     * Responses API tool-calling protocol:
     *
     * 1. Preserve the model output items.
     * 2. Append function_call_output items.
     * 3. Send the combined input back to OpenAI.
     */
    const responseOutput =
      Array.isArray(
        request.response
          .output,
      )
        ? request.response.output
        : [];

    input = [
      ...input,

      ...responseOutput,

      ...execution.outputs,
    ];
  }

  throw new OpenAiError(
    "GameVortex AI reached the maximum tool-call depth.",

    "OPENAI_BAD_REQUEST",

    String(
      lastRequestId,
    ),
  );
}

/* =========================================================
 * STREAMING COMPATIBILITY
 * ======================================================= */

/**
 * Tool execution must complete before the final answer
 * is exposed to the existing chat stream.
 *
 * This keeps the current /api/ai/chat response contract
 * stable while Task 8 is being integrated.
 */
export async function* aiChatWithGameVortexToolsStream(
  messages: OpenAiMessage[],
  options: GameVortexToolChatOptions = {},
): AsyncGenerator<
  string,
  void,
  unknown
> {
  const result =
    await aiChatWithGameVortexTools(
      messages,
      options,
    );

  const text =
    result.text;

  /*
   * Small chunks preserve the existing streaming UX
   * without changing the route's SSE format.
   */
  const chunkSize = 80;

  for (
    let index = 0;
    index < text.length;
    index += chunkSize
  ) {
    yield text.slice(
      index,
      index +
        chunkSize,
    );
  }
}
