import { z } from "zod";

import { db } from "@/lib/prisma";

import {
  aiToolErrorResult,
  aiToolPaginationSchema,
  aiToolResult,
  getAiToolPagination,
  normalizeAiToolSearch,
  parseAiToolInput,
  requireAiToolUser,
} from "./core";

const searchLibrarySchema = z.object({
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
    aiToolPaginationSchema.optional(),
});

/**
 * Search the authenticated user's own GameVortex library.
 *
 * Important:
 * The userId is NEVER accepted from AI input.
 * It always comes from the authenticated session.
 *
 * This prevents IDOR-style access to another user's library.
 */
export async function searchLibrary(
  rawInput: unknown,
) {
  try {
    const context =
      await requireAiToolUser();

    const input = parseAiToolInput(
      searchLibrarySchema,
      rawInput,
    );

    const query = input.query
      ? normalizeAiToolSearch(
          input.query,
        )
      : undefined;

    const pagination = {
      page:
        input.pagination?.page ?? 1,

      limit:
        input.pagination?.limit ?? 10,
    };

    const { skip, take } =
      getAiToolPagination(
        pagination,
      );

    const where = {
      userId: context.user.id,

      ...(input.status
        ? {
            status: input.status,
          }
        : {}),

      ...(query
        ? {
            game: {
              OR: [
                {
                  titleEn: {
                    contains: query,
                    mode: "insensitive" as const,
                  },
                },
                {
                  titleAr: {
                    contains: query,
                    mode: "insensitive" as const,
                  },
                },
                {
                  slug: {
                    contains: query,
                    mode: "insensitive" as const,
                  },
                },
              ],
            },
          }
        : {}),
    };

    const [libraryItems, total] =
      await Promise.all([
        db.gameLibraryItem.findMany({
          where,

          orderBy: {
            updatedAt: "desc",
          },

          skip,
          take,

          select: {
            id: true,
            status: true,
            createdAt: true,
            updatedAt: true,

            game: {
              select: {
                id: true,
                slug: true,
                titleAr: true,
                titleEn: true,
                description: true,
                platform: true,
                genre: true,
                coverUrl: true,
                ratingAverage: true,
                ratingCount: true,

                gamePlatforms: {
                  select: {
                    platform: true,
                  },

                  orderBy: {
                    platform: "asc",
                  },
                },
              },
            },
          },
        }),

        db.gameLibraryItem.count({
          where,
        }),
      ]);

    return aiToolResult(
      libraryItems.map((item) => ({
        id: item.id,

        status: item.status,

        createdAt:
          item.createdAt.toISOString(),

        updatedAt:
          item.updatedAt.toISOString(),

        game: {
          id: item.game.id,
          slug: item.game.slug,
          titleAr: item.game.titleAr,
          titleEn: item.game.titleEn,
          description:
            item.game.description,
          platform:
            item.game.platform,
          genre: item.game.genre,
          coverUrl:
            item.game.coverUrl,
          ratingAverage:
            item.game.ratingAverage,
          ratingCount:
            item.game.ratingCount,

          platforms:
            item.game.gamePlatforms.map(
              (platform) =>
                platform.platform,
            ),
        },
      })),
      {
        page: pagination.page,
        limit: pagination.limit,
        total,
        returned:
          libraryItems.length,
        hasMore:
          skip + libraryItems.length <
          total,
      },
    );
  } catch (error) {
    return aiToolErrorResult(error);
  }
}
