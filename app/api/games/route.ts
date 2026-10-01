import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { getPlatformEnum } from "@/lib/platforms";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const platformParam = searchParams.get("platform");
    const category = searchParams.get("category");
    const search = searchParams.get("search");
    const sortParam = searchParams.get("sort");
    const pageParam = Number(searchParams.get("page") ?? "1");
    const limitParam = Number(searchParams.get("limit") ?? "24");

    const page =
      Number.isFinite(pageParam) && pageParam > 0
        ? Math.floor(pageParam)
        : 1;

    const limit =
      Number.isFinite(limitParam) &&
      limitParam > 0 &&
      limitParam <= 100
        ? Math.floor(limitParam)
        : 24;

    const platform = getPlatformEnum(platformParam);

    const sort = ["rating", "popular", "newest", "views"].includes(sortParam ?? "")
      ? sortParam!
      : "newest";

    const where: Prisma.GameWhereInput = {
      published: true,
    };

    if (category?.trim()) {
      where.gameCategories = {
        some: {
          category: {
            OR: [
              { slug: category.trim().toLowerCase() },
              { nameEn: { equals: category.trim(), mode: "insensitive" } },
              { nameAr: { equals: category.trim(), mode: "insensitive" } },
            ],
          },
        },
      };
    }

    if (search?.trim()) {
      const query = search.trim();

      where.OR = [
        {
          titleAr: {
            contains: query,
            mode: "insensitive",
          },
        },
        {
          titleEn: {
            contains: query,
            mode: "insensitive",
          },
        },
        {
          slug: {
            contains: query,
            mode: "insensitive",
          },
        },
      ];
    }

    if (platform) {
      where.gamePlatforms = {
        some: {
          platform,
        },
      };
    }

    const [games, total] = await Promise.all([
      prisma.game.findMany({
        where,
        include: {
          gamePlatforms: true,
          gameCategories: {
            include: { category: true },
          },
        },
        orderBy:
          sort === "popular"
            ? [
                { playCount: "desc" },
                { viewCount: "desc" },
                { id: "desc" },
              ]
            : sort === "views"
              ? [
                  { viewCount: "desc" },
                  { playCount: "desc" },
                  { id: "desc" },
                ]
              : sort === "rating"
                ? [
                    { featured: "desc" },
                    { ratingAverage: "desc" },
                    { ratingCount: "desc" },
                    { id: "desc" },
                  ]
                : [
                    { createdAt: "desc" },
                    { id: "desc" },
                  ],
        skip: (page - 1) * limit,
        take: limit,
      }),

      prisma.game.count({
        where,
      }),
    ]);

    return NextResponse.json({
      success: true,
      data: games,
      pagination: {
        page,
        limit,
        total,
        sort,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("GET /api/games error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Failed to load games",
      },
      {
        status: 500,
      },
    );
  }
}
