import { z } from "zod";

import { db } from "@/lib/prisma";

import {
  aiToolErrorResult,
  aiToolIdSchema,
  aiToolPaginationSchema,
  aiToolResult,
  getAiToolPagination,
  normalizeAiToolSearch,
  parseAiToolInput,
  requireAiToolUser,
} from "./core";

const searchGamesSchema = z.object({
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

  pagination: aiToolPaginationSchema.optional(),
});

const getGameSchema = z.object({
  id: aiToolIdSchema.optional(),

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
}).refine(
  (value) => Boolean(value.id || value.slug),
  {
    message: "Either game id or slug is required.",
  },
);

const getPlatformGamesSchema = z.object({
  platform: z.enum([
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

  pagination: aiToolPaginationSchema.optional(),
});

function normalizeOptional(
  value?: string,
): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim();

  return normalized.length > 0
    ? normalized
    : undefined;
}

/**
 * GameVortex AI Tool:
 * Search published games in the public GameVortex catalog.
 */
export async function searchGames(
  rawInput: unknown,
) {
  try {
    await requireAiToolUser();

    const input = parseAiToolInput(
      searchGamesSchema,
      rawInput,
    );

    const query = normalizeAiToolSearch(
      input.query,
    );

    const platform = normalizeOptional(
      input.platform,
    );

    const genre = normalizeOptional(
      input.genre,
    );

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
      published: true,

      AND: [
        {
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
            {
              description: {
                contains: query,
                mode: "insensitive" as const,
              },
            },
          ],
        },

        ...(platform
          ? [
              {
                OR: [
                  {
                    platform: {
                      contains: platform,
                      mode: "insensitive" as const,
                    },
                  },
                  {
                    gamePlatforms: {
                      some: {
                        platform:
                          platform.toUpperCase() as any,
                      },
                    },
                  },
                ],
              },
            ]
          : []),

        ...(genre
          ? [
              {
                genre: {
                  contains: genre,
                  mode: "insensitive" as const,
                },
              },
            ]
          : []),
      ],
    };

    const [games, total] =
      await Promise.all([
        db.game.findMany({
          where,
          orderBy: [
            {
              featured: "desc",
            },
            {
              ratingAverage: "desc",
            },
            {
              ratingCount: "desc",
            },
            {
              titleEn: "asc",
            },
          ],
          skip,
          take,

          select: {
            id: true,
            slug: true,
            titleAr: true,
            titleEn: true,
            description: true,
            platform: true,
            genre: true,
            priceCents: true,
            discountPercent: true,
            coverUrl: true,
            officialUrl: true,
            ratingAverage: true,
            ratingCount: true,
            featured: true,

            gamePlatforms: {
              select: {
                platform: true,
              },
              orderBy: {
                platform: "asc",
              },
            },
          },
        }),

        db.game.count({
          where,
        }),
      ]);

    return aiToolResult(
      games.map((game) => ({
        id: game.id,
        slug: game.slug,
        titleAr: game.titleAr,
        titleEn: game.titleEn,
        description: game.description,
        platform: game.platform,
        genre: game.genre,
        priceCents: game.priceCents,
        discountPercent:
          game.discountPercent,
        coverUrl: game.coverUrl,
        officialUrl: game.officialUrl,
        ratingAverage:
          game.ratingAverage,
        ratingCount:
          game.ratingCount,
        featured: game.featured,

        platforms:
          game.gamePlatforms.map(
            (item) => item.platform,
          ),
      })),

      {
        page: pagination.page,
        limit: pagination.limit,
        total,
        returned: games.length,
        hasMore:
          skip + games.length < total,
      },
    );
  } catch (error) {
    return aiToolErrorResult(error);
  }
}

/**
 * GameVortex AI Tool:
 * Get one published game by id or slug.
 */
export async function getGame(
  rawInput: unknown,
) {
  try {
    await requireAiToolUser();

    const input = parseAiToolInput(
      getGameSchema,
      rawInput,
    );

    const game =
      input.id
        ? await db.game.findFirst({
            where: {
              id: input.id,
              published: true,
            },

            select: {
              id: true,
              slug: true,
              titleAr: true,
              titleEn: true,
              description: true,
              platform: true,
              genre: true,
              priceCents: true,
              discountPercent: true,
              coverUrl: true,
              officialUrl: true,
              ratingAverage: true,
              ratingCount: true,
              playCount: true,
              viewCount: true,
              featured: true,

              gamePlatforms: {
                select: {
                  platform: true,
                },
                orderBy: {
                  platform: "asc",
                },
              },
            },
          })
        : await db.game.findFirst({
            where: {
              slug: input.slug,
              published: true,
            },

            select: {
              id: true,
              slug: true,
              titleAr: true,
              titleEn: true,
              description: true,
              platform: true,
              genre: true,
              priceCents: true,
              discountPercent: true,
              coverUrl: true,
              officialUrl: true,
              ratingAverage: true,
              ratingCount: true,
              playCount: true,
              viewCount: true,
              featured: true,

              gamePlatforms: {
                select: {
                  platform: true,
                },
                orderBy: {
                  platform: "asc",
                },
              },
            },
          });

    if (!game) {
      return aiToolErrorResult(
        new Error("GAME_NOT_FOUND"),
      );
    }

    return aiToolResult({
      id: game.id,
      slug: game.slug,
      titleAr: game.titleAr,
      titleEn: game.titleEn,
      description: game.description,
      platform: game.platform,
      genre: game.genre,
      priceCents: game.priceCents,
      discountPercent:
        game.discountPercent,
      coverUrl: game.coverUrl,
      officialUrl: game.officialUrl,
      ratingAverage:
        game.ratingAverage,
      ratingCount:
        game.ratingCount,
      playCount:
        game.playCount,
      viewCount:
        game.viewCount,
      featured:
        game.featured,

      platforms:
        game.gamePlatforms.map(
          (item) => item.platform,
        ),
    });
  } catch (error) {
    return aiToolErrorResult(error);
  }
}

/**
 * GameVortex AI Tool:
 * Get published games assigned to one GameVortex platform.
 */
export async function getPlatformGames(
  rawInput: unknown,
) {
  try {
    await requireAiToolUser();

    const input = parseAiToolInput(
      getPlatformGamesSchema,
      rawInput,
    );

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
      published: true,

      gamePlatforms: {
        some: {
          platform: input.platform,
        },
      },
    };

    const [games, total] =
      await Promise.all([
        db.game.findMany({
          where,
          orderBy: [
            {
              featured: "desc",
            },
            {
              ratingAverage: "desc",
            },
            {
              ratingCount: "desc",
            },
            {
              titleEn: "asc",
            },
          ],
          skip,
          take,

          select: {
            id: true,
            slug: true,
            titleAr: true,
            titleEn: true,
            description: true,
            platform: true,
            genre: true,
            priceCents: true,
            discountPercent: true,
            coverUrl: true,
            officialUrl: true,
            ratingAverage: true,
            ratingCount: true,
            featured: true,

            gamePlatforms: {
              select: {
                platform: true,
              },
              orderBy: {
                platform: "asc",
              },
            },
          },
        }),

        db.game.count({
          where,
        }),
      ]);

    return aiToolResult(
      games.map((game) => ({
        id: game.id,
        slug: game.slug,
        titleAr: game.titleAr,
        titleEn: game.titleEn,
        description: game.description,
        platform: game.platform,
        genre: game.genre,
        priceCents: game.priceCents,
        discountPercent:
          game.discountPercent,
        coverUrl: game.coverUrl,
        officialUrl: game.officialUrl,
        ratingAverage:
          game.ratingAverage,
        ratingCount:
          game.ratingCount,
        featured: game.featured,

        platforms:
          game.gamePlatforms.map(
            (item) => item.platform,
          ),
      })),

      {
        page: pagination.page,
        limit: pagination.limit,
        total,
        returned: games.length,
        hasMore:
          skip + games.length < total,
      },
    );
  } catch (error) {
    return aiToolErrorResult(error);
  }
}
