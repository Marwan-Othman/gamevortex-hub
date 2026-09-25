import { z } from "zod";

import {
  aiToolErrorResult,
  parseAiToolInput,
} from "./core";

import {
  getGame,
  getPlatformGames,
  searchGames,
} from "./games";

import {
  getProduct,
  searchApps,
  searchMarketplace,
} from "./store";

import {
  searchLibrary,
} from "./user";

export type AiToolExecutor = (
  input: unknown,
) => Promise<unknown>;

export type AiToolDefinition = {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  execute: AiToolExecutor;
};

export const AI_TOOL_REGISTRY:
  readonly AiToolDefinition[] =
  [
    {
      name:
        "searchGames",

      description:
        "Search published games available in the GameVortex game catalog.",

      inputSchema:
        z.object({
          query: z
            .string()
            .trim()
            .min(1)
            .max(100),

          platform: z
            .string()
            .trim()
            .min(1)
            .max(50)
            .optional(),

          genre: z
            .string()
            .trim()
            .min(1)
            .max(80)
            .optional(),

          pagination:
            z.object({
              page: z
                .number()
                .int()
                .min(1)
                .max(1000)
                .default(1),

              limit: z
                .number()
                .int()
                .min(1)
                .max(25)
                .default(10),
            })
              .optional(),
        }),

      execute:
        searchGames,
    },

    {
      name:
        "getGame",

      description:
        "Get details about one published GameVortex game by id or slug.",

      inputSchema:
        z.object({
          id: z
            .string()
            .trim()
            .min(1)
            .max(64)
            .regex(
              /^[a-zA-Z0-9_-]+$/,
              "Invalid identifier.",
            )
            .optional(),

          slug: z
            .string()
            .trim()
            .min(1)
            .max(120)
            .regex(
              /^[a-zA-Z0-9_-]+$/,
              "Invalid game slug.",
            )
            .optional(),
        })
          .refine(
            (value) =>
              Boolean(
                value.id ||
                value.slug,
              ),
            {
              message:
                "Either game id or slug is required.",
            },
          ),

      execute:
        getGame,
    },

    {
      name:
        "getPlatformGames",

      description:
        "Get published GameVortex games assigned to a specific platform.",

      inputSchema:
        z.object({
          platform:
            z.enum([
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
            ]),

          pagination:
            z.object({
              page: z
                .number()
                .int()
                .min(1)
                .max(1000)
                .default(1),

              limit: z
                .number()
                .int()
                .min(1)
                .max(25)
                .default(10),
            })
              .optional(),
        }),

      execute:
        getPlatformGames,
    },

    {
      name:
        "searchApps",

      description:
        "Search active GameVortex apps and digital products.",

      inputSchema:
        z.object({
          query: z
            .string()
            .trim()
            .min(1)
            .max(100),

          platform: z
            .string()
            .trim()
            .min(1)
            .max(50)
            .optional(),

          region: z
            .string()
            .trim()
            .min(1)
            .max(50)
            .optional(),

          pagination:
            z.object({
              page: z
                .number()
                .int()
                .min(1)
                .max(1000)
                .default(1),

              limit: z
                .number()
                .int()
                .min(1)
                .max(25)
                .default(10),
            })
              .optional(),
        }),

      execute:
        searchApps,
    },

    {
      name:
        "searchMarketplace",

      description:
        "Search active products currently available in the GameVortex Marketplace.",

      inputSchema:
        z.object({
          query: z
            .string()
            .trim()
            .min(1)
            .max(100),

          kind: z
            .enum([
              "GAME_KEY",
              "GIFT_CARD",
              "TOP_UP",
              "DLC",
              "SUBSCRIPTION",
              "DIGITAL_ITEM",
            ])
            .optional(),

          platform: z
            .string()
            .trim()
            .min(1)
            .max(50)
            .optional(),

          region: z
            .string()
            .trim()
            .min(1)
            .max(50)
            .optional(),

          pagination:
            z.object({
              page: z
                .number()
                .int()
                .min(1)
                .max(1000)
                .default(1),

              limit: z
                .number()
                .int()
                .min(1)
                .max(25)
                .default(10),
            })
              .optional(),
        }),

      execute:
        searchMarketplace,
    },

    {
      name:
        "getProduct",

      description:
        "Get details about one active GameVortex Marketplace product by id or SKU.",

      inputSchema:
        z.object({
          id: z
            .string()
            .trim()
            .min(1)
            .max(64)
            .regex(
              /^[a-zA-Z0-9_-]+$/,
              "Invalid identifier.",
            )
            .optional(),

          sku: z
            .string()
            .trim()
            .min(1)
            .max(150)
            .regex(
              /^[a-zA-Z0-9_.-]+$/,
              "Invalid product SKU.",
            )
            .optional(),
        })
          .refine(
            (value) =>
              Boolean(
                value.id ||
                value.sku,
              ),
            {
              message:
                "Either product id or SKU is required.",
            },
          ),

      execute:
        getProduct,
    },

    {
      name:
        "searchLibrary",

      description:
        "Search the authenticated user's own GameVortex game library.",

      inputSchema:
        z.object({
          query: z
            .string()
            .trim()
            .min(1)
            .max(100)
            .optional(),

          status: z
            .enum([
              "WANT",
              "PLAYING",
              "BEATEN",
              "ARCHIVED",
            ])
            .optional(),

          pagination:
            z.object({
              page: z
                .number()
                .int()
                .min(1)
                .max(1000)
                .default(1),

              limit: z
                .number()
                .int()
                .min(1)
                .max(25)
                .default(10),
            })
              .optional(),
        }),

      execute:
        searchLibrary,
    },
  ] as const;

export function getAiTool(
  name: string,
): AiToolDefinition | undefined {
  return AI_TOOL_REGISTRY.find(
    (tool) =>
      tool.name === name,
  );
}

export function getAiToolNames(): string[] {
  return AI_TOOL_REGISTRY.map(
    (tool) => tool.name,
  );
}

function validateToolName(
  name: unknown,
): string {
  if (
    typeof name !==
      "string" ||
    name.length === 0 ||
    name.length > 100
  ) {
    throw new Error(
      "Invalid AI Tool name.",
    );
  }

  return name;
}

export async function executeAiTool(
  name: string,
  input: unknown,
): Promise<unknown> {
  try {
    const validatedName =
      validateToolName(
        name,
      );

    const tool =
      getAiTool(
        validatedName,
      );

    if (!tool) {
      return {
        ok: false,
        error: {
          code:
            "UNKNOWN_AI_TOOL",
          message:
            "The requested GameVortex AI tool does not exist.",
        },
      };
    }

    const validatedInput =
      parseAiToolInput(
        tool.inputSchema,
        input,
      );

    return await tool.execute(
      validatedInput,
    );
  } catch (error) {
    return aiToolErrorResult(
      error,
    );
  }
}
