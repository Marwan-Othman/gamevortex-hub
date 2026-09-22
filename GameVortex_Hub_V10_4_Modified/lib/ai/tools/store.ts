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

const searchMarketplaceSchema = z.object({
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

  pagination: aiToolPaginationSchema.optional(),
});

const getProductSchema = z.object({
  id: aiToolIdSchema.optional(),

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
}).refine(
  (value) => Boolean(value.id || value.sku),
  {
    message:
      "Either product id or SKU is required.",
  },
);

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
 * Search active GameVortex Marketplace products.
 *
 * Only active products are exposed to the AI.
 * Internal inventory details, supplier data, provider
 * configuration and redemption secrets are never returned.
 */
export async function searchMarketplace(
  rawInput: unknown,
) {
  try {
    await requireAiToolUser();

    const input = parseAiToolInput(
      searchMarketplaceSchema,
      rawInput,
    );

    const query = normalizeAiToolSearch(
      input.query,
    );

    const kind = input.kind;

    const platform = normalizeOptional(
      input.platform,
    );

    const region = normalizeOptional(
      input.region,
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
      active: true,

      AND: [
        {
          OR: [
            {
              title: {
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
            {
              sku: {
                contains: query,
                mode: "insensitive" as const,
              },
            },
          ],
        },

        ...(kind
          ? [
              {
                kind,
              },
            ]
          : []),

        ...(platform
          ? [
              {
                game: {
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
              },
            ]
          : []),

        ...(region
          ? [
              {
                region: {
                  contains: region,
                  mode: "insensitive" as const,
                },
              },
            ]
          : []),
      ],
    };

    const [products, total] =
      await Promise.all([
        db.gameProduct.findMany({
          where,

          orderBy: [
            {
              createdAt: "desc",
            },
            {
              title: "asc",
            },
          ],

          skip,
          take,

          select: {
            id: true,
            sku: true,
            title: true,
            description: true,
            priceCents: true,
            currency: true,
            kind: true,
            deliveryType: true,
            region: true,
            country: true,
            denominationCents: true,

            game: {
              select: {
                id: true,
                slug: true,
                titleAr: true,
                titleEn: true,
                coverUrl: true,

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

        db.gameProduct.count({
          where,
        }),
      ]);

    return aiToolResult(
      products.map((product) => ({
        id: product.id,
        sku: product.sku,
        title: product.title,
        description: product.description,
        priceCents: product.priceCents,
        currency: product.currency,
        kind: product.kind,
        deliveryType: product.deliveryType,
        region: product.region,
        country: product.country,
        denominationCents:
          product.denominationCents,

        game: {
          id: product.game.id,
          slug: product.game.slug,
          titleAr: product.game.titleAr,
          titleEn: product.game.titleEn,
          coverUrl: product.game.coverUrl,

          platforms:
            product.game.gamePlatforms.map(
              (item) => item.platform,
            ),
        },
      })),
      {
        page: pagination.page,
        limit: pagination.limit,
        total,
        returned: products.length,
        hasMore:
          skip + products.length < total,
      },
    );
  } catch (error) {
    return aiToolErrorResult(error);
  }
}

/**
 * Get one active Marketplace product.
 *
 * Product can be identified by id or SKU.
 */
export async function getProduct(
  rawInput: unknown,
) {
  try {
    await requireAiToolUser();

    const input = parseAiToolInput(
      getProductSchema,
      rawInput,
    );

    const product = input.id
      ? await db.gameProduct.findFirst({
          where: {
            id: input.id,
            active: true,
          },

          select: {
            id: true,
            sku: true,
            title: true,
            description: true,
            priceCents: true,
            currency: true,
            kind: true,
            deliveryType: true,
            region: true,
            country: true,
            denominationCents: true,

            game: {
              select: {
                id: true,
                slug: true,
                titleAr: true,
                titleEn: true,
                coverUrl: true,

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
        })
      : await db.gameProduct.findFirst({
          where: {
            sku: input.sku,
            active: true,
          },

          select: {
            id: true,
            sku: true,
            title: true,
            description: true,
            priceCents: true,
            currency: true,
            kind: true,
            deliveryType: true,
            region: true,
            country: true,
            denominationCents: true,

            game: {
              select: {
                id: true,
                slug: true,
                titleAr: true,
                titleEn: true,
                coverUrl: true,

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
        });

    if (!product) {
      return aiToolErrorResult(
        new Error(
          "MARKETPLACE_PRODUCT_NOT_FOUND",
        ),
      );
    }

    return aiToolResult({
      id: product.id,
      sku: product.sku,
      title: product.title,
      description: product.description,
      priceCents: product.priceCents,
      currency: product.currency,
      kind: product.kind,
      deliveryType: product.deliveryType,
      region: product.region,
      country: product.country,
      denominationCents:
        product.denominationCents,

      game: {
        id: product.game.id,
        slug: product.game.slug,
        titleAr: product.game.titleAr,
        titleEn: product.game.titleEn,
        coverUrl: product.game.coverUrl,

        platforms:
          product.game.gamePlatforms.map(
            (item) => item.platform,
          ),
      },
    });
  } catch (error) {
    return aiToolErrorResult(error);
  }
}
