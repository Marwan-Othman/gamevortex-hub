import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getPlatformEnum, normalizePlatform } from "@/lib/platforms";

/**
 * Read-only list of games for the owner (used by the store product form).
 * Creating and editing games happens in /admin/content via /api/admin/content.
 */
export const dynamic = "force-dynamic";

async function requireSuperAdmin() {
  const { getOptionalUser } = await import("@/lib/auth");
  const user = await getOptionalUser();
  if (!user || user.role !== "SUPER_ADMIN") return null;
  return user;
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireSuperAdmin();
    if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search")?.trim() ?? "";
    const platformParam = searchParams.get("platform")?.trim() ?? "";
    const platform = normalizePlatform(platformParam);
    const where: Prisma.GameWhereInput = {};

    if (search) {
      where.OR = [
        { titleAr: { contains: search, mode: "insensitive" } },
        { titleEn: { contains: search, mode: "insensitive" } },
        { slug: { contains: search, mode: "insensitive" } },
      ];
    }
    const platformEnum = platform ? getPlatformEnum(platform) : null;
    if (platformEnum) where.gamePlatforms = { some: { platform: platformEnum } };

    const games = await prisma.game.findMany({
      where,
      include: { gamePlatforms: true, gameCategories: { include: { category: true } } },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ success: true, data: games });
  } catch (error) {
    console.error("GET /api/admin/games error:", error);
    return NextResponse.json({ success: false, error: "Failed to load games" }, { status: 500 });
  }
}
