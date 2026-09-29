import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getPlatformEnum,
  normalizePlatform,
} from "@/lib/platforms";
import { ensureCategoryIds } from "@/lib/categories";

export const dynamic = "force-dynamic";

async function requireSuperAdmin() {
  const { getOptionalUser } = await import("@/lib/auth");

  const user = await getOptionalUser();

  if (!user || user.role !== "SUPER_ADMIN") {
    return null;
  }

  return user;
}

function normalizePlatforms(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  const result = new Set<
    | "PC"
    | "PLAYSTATION"
    | "XBOX"
    | "NINTENDO"
    | "ANDROID"
    | "IOS"
    | "MAC"
    | "LINUX"
    | "STEAM_DECK"
    | "WEB"
  >();

  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }

    const platform = getPlatformEnum(item);

    if (platform) {
      result.add(platform);
    }
  }

  return Array.from(result);
}

function normalizeSourceStatus(value: unknown) {
  if (
    value === "VERIFIED" ||
    value === "PENDING_REVIEW" ||
    value === "UNPUBLISHED" ||
    value === "NEEDS_SOURCE"
  ) {
    return value;
  }

  return "NEEDS_SOURCE" as const;
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireSuperAdmin();

    if (!user) {
      return NextResponse.json(
        {
          success: false,
          error: "Unauthorized",
        },
        { status: 401 },
      );
    }

    const { searchParams } = new URL(request.url);

    const search = searchParams.get("search")?.trim() ?? "";
    const platformParam =
      searchParams.get("platform")?.trim() ?? "";

    const platform = normalizePlatform(platformParam);

    const where: any = {};

    if (search) {
      where.OR = [
        {
          titleAr: {
            contains: search,
            mode: "insensitive",
          },
        },
        {
          titleEn: {
            contains: search,
            mode: "insensitive",
          },
        },
        {
          slug: {
            contains: search,
            mode: "insensitive",
          },
        },
      ];
    }

    if (platform) {
      where.gamePlatforms = {
        some: {
          platform: platform.toUpperCase(),
        },
      };
    }

    const games = await prisma.game.findMany({
      where,
      include: {
        gamePlatforms: true,
        gameCategories: { include: { category: true } },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return NextResponse.json({
      success: true,
      data: games,
    });
  } catch (error) {
    console.error("GET /api/admin/games error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Failed to load games",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireSuperAdmin();

    if (!user) {
      return NextResponse.json(
        {
          success: false,
          error: "Unauthorized",
        },
        { status: 401 },
      );
    }

    const body = await request.json();

    const {
      titleAr,
      titleEn,
      slug,
      descriptionAr,
      descriptionEn,
      genre,
      category,
      platform,
      platforms,
      price,
      priceCents,
      discount,
      discountPercent,
      coverUrl,
      officialUrl,
      downloadSource,
      sourceStatus,
      published,
      featured,
    } = body;

    if (
      typeof titleAr !== "string" ||
      !titleAr.trim() ||
      typeof titleEn !== "string" ||
      !titleEn.trim() ||
      typeof slug !== "string" ||
      !slug.trim()
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "titleAr, titleEn and slug are required",
        },
        { status: 400 },
      );
    }

    const platformValues = normalizePlatforms(
      Array.isArray(platforms)
        ? platforms
        : platform
          ? [platform]
          : [],
    );

    const normalizedSourceStatus =
      normalizeSourceStatus(sourceStatus);

    const description =
      typeof descriptionAr === "string" &&
      descriptionAr.trim()
        ? descriptionAr.trim()
        : typeof descriptionEn === "string" &&
            descriptionEn.trim()
          ? descriptionEn.trim()
          : null;

    const categoryValues = Array.isArray(body.categoryIds)
      ? body.categoryIds
      : typeof category === "string" && category.trim()
        ? [category.trim()]
        : typeof genre === "string" && genre.trim()
          ? [genre.trim()]
          : [];

    const categoryIds = await ensureCategoryIds(prisma, categoryValues);

    const normalizedGenre =
      typeof genre === "string" && genre.trim()
        ? genre.trim()
        : typeof category === "string" && category.trim()
          ? category.trim()
          : null;

    const normalizedPriceCents =
      typeof priceCents === "number" &&
      Number.isFinite(priceCents)
        ? Math.max(0, Math.round(priceCents))
        : typeof price === "number" &&
            Number.isFinite(price)
          ? Math.max(0, Math.round(price * 100))
          : 0;

    const normalizedDiscountPercent =
      typeof discountPercent === "number" &&
      Number.isFinite(discountPercent)
        ? Math.min(
            100,
            Math.max(0, Math.round(discountPercent)),
          )
        : typeof discount === "number" &&
            Number.isFinite(discount)
          ? Math.min(
              100,
              Math.max(0, Math.round(discount)),
            )
          : 0;

    const game = await prisma.game.create({
      data: {
        titleAr: titleAr.trim(),
        titleEn: titleEn.trim(),
        slug: slug.trim(),

        description,

        genre: normalizedGenre,

        platform:
          platformValues.length > 0
            ? platformValues.join(",")
            : null,

        priceCents: normalizedPriceCents,

        discountPercent: normalizedDiscountPercent,

        coverUrl:
          typeof coverUrl === "string"
            ? coverUrl.trim()
            : null,

        officialUrl:
          typeof officialUrl === "string"
            ? officialUrl.trim()
            : null,

        downloadSource:
          typeof downloadSource === "string"
            ? downloadSource.trim()
            : null,

        sourceStatus: normalizedSourceStatus,

        published:
          typeof published === "boolean"
            ? published
            : false,

        featured:
          typeof featured === "boolean"
            ? featured
            : false,

        gamePlatforms:
          platformValues.length > 0
            ? {
                create: platformValues.map((item) => ({
                  platform: item,
                })),
              }
            : undefined,

        gameCategories:
          categoryIds.length > 0
            ? {
                create: categoryIds.map((categoryId) => ({ categoryId })),
              }
            : undefined,
      },

      include: {
        gamePlatforms: true,
      },
    });

    return NextResponse.json(
      {
        success: true,
        data: game,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("POST /api/admin/games error:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Failed to create game",
      },
      { status: 500 },
    );
  }
}
