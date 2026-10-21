import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { getPlatformEnum } from "@/lib/platforms";
import { guardRead } from "@/lib/api";
import { toPublicContent } from "@/lib/downloads";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const blocked = await guardRead(request, "apps:list", 120);
  if (blocked) return blocked;

  try {
    const p = request.nextUrl.searchParams;
    const search = p.get("search")?.trim().slice(0, 80) ?? "";
    const category = p.get("category")?.trim().slice(0, 80) ?? "";
    const platform = getPlatformEnum(p.get("platform"));
    const sort = ["rating", "popular", "newest", "views"].includes(p.get("sort") ?? "") ? p.get("sort")! : "newest";
    const page = Math.max(1, Math.floor(Number(p.get("page") || 1)) || 1);
    const limit = Math.min(60, Math.max(1, Math.floor(Number(p.get("limit") || 24)) || 24));
    const where: Prisma.AppWhereInput = { published: true };
    if (search) where.OR = [
      { nameAr: { contains: search, mode: "insensitive" } },
      { nameEn: { contains: search, mode: "insensitive" } },
      { developer: { contains: search, mode: "insensitive" } },
      { slug: { contains: search, mode: "insensitive" } },
    ];
    if (platform) where.appPlatforms = { some: { platform } };
    if (category) where.appCategories = { some: { category: { OR: [
      { slug: category.toLowerCase() },
      { nameAr: { equals: category, mode: "insensitive" } },
      { nameEn: { equals: category, mode: "insensitive" } },
    ] } } };
    const orderBy = sort === "rating" ? [{ featured: "desc" as const }, { ratingAverage: "desc" as const }, { ratingCount: "desc" as const }] : sort === "popular" ? [{ downloadCount: "desc" as const }, { viewCount: "desc" as const }] : sort === "views" ? [{ viewCount: "desc" as const }, { downloadCount: "desc" as const }] : [{ createdAt: "desc" as const }, { id: "desc" as const }];
    const [data, total] = await Promise.all([
      db.app.findMany({ where, orderBy, skip: (page - 1) * limit, take: limit, include: { appPlatforms: true, appCategories: { include: { category: true } } } }),
      db.app.count({ where }),
    ]);
    return NextResponse.json({ success: true, data: data.map(toPublicContent), pagination: { page, limit, total, pages: Math.ceil(total / limit), sort } });
  } catch (error) {
    // Keep database credentials, hosts and Prisma internals out of public responses and raw logs.
    console.error("GET /api/apps failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      { success: false, error: "APP_CATALOG_UNAVAILABLE" },
      { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "30" } },
    );
  }
}
