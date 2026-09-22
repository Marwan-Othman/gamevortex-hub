import { z } from "zod";

import {
  getGame,
  searchGames,
} from "./games";

import {
  getProduct,
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

/**
 * Central registry for all GameVortex AI Tools.
 *
 * This registry does NOT give the AI direct database access.
 * Every executor remains responsible for:
 *
 * - Authentication
 * - Authorization
 * - Input validation
 * - Safe Prisma queries
 * - Minimal response data
 */
export const AI_TOOL_REGISTRY: readonly AiToolDefinition[] =
  [
    {
      name: "searchGames",

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
      name: "getGame",

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
      name: "searchMarketplace",

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
      name: "getProduct",

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
      name: "searchLibrary",

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

/**
 * Get a Tool definition by its public name.
 */
export function getAiTool(
  name: string,
): AiToolDefinition | undefined {
  return AI_TOOL_REGISTRY.find(
    (tool) => tool.name === name,
  );
}

/**
 * Return only the public Tool names.
 */
export function getAiToolNames(): string[] {
  return AI_TOOL_REGISTRY.map(
    (tool) => tool.name,
  );
}

/**
 * Execute one registered GameVortex Tool.
 *
 * The Tool itself remains responsible for its own
 * authentication, authorization and validation.
 */
export async function executeAiTool(
  name: string,
  input: unknown,
): Promise<unknown> {
  const tool =
    getAiTool(name);

  if (!tool) {
    return {
      ok: false,
      error: {
        code: "UNKNOWN_AI_TOOL",
        message:
          "The requested GameVortex AI tool does not exist.",
      },
    };
  }

  return tool.execute(input);
}
