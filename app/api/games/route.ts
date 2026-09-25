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

    const where: Prisma.GameWhereInput = {
      published: true,
    };

    if (category?.trim()) {
      where.genre = category.trim();
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
        },
        orderBy: {
          createdAt: "desc",
        },
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
