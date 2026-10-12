import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/prisma";
import { getOptionalUser } from "@/lib/auth";
import { getVipAccess } from "@/lib/vip";
import { guardRead, internalError } from "@/lib/api";
import { WALLPAPER_CATEGORIES } from "@/lib/wallpapers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 18;
const CATEGORY_SET = new Set<string>(WALLPAPER_CATEGORIES);

/**
 * مكتبة خلفيات الاستوديو بصفحات (cursor). خلفيات VIP تظهر للجميع كبطاقات مقفلة
 * بدون أي رابط ملف لغير المشتركين؛ الملف نفسه محمي أيضًا في /api/wallpapers/[id]/media.
 */
export async function GET(request: NextRequest) {
  const blocked = await guardRead(request, "wallpapers:studio:library", 120);
  if (blocked) return blocked;
  try {
    const url = new URL(request.url);
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 60);
    const categoryParam = (url.searchParams.get("category") ?? "").toUpperCase();
    const cursor = url.searchParams.get("cursor");
    const onlyFavorites = url.searchParams.get("favorites") === "1";

    const user = await getOptionalUser();
    const isVip = user ? (await getVipAccess(user.id)).isVip : false;
    if (onlyFavorites && !user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

    const where: Prisma.WallpaperWhereInput = {
      published: true,
      moderationStatus: "APPROVED",
      mediaType: "IMAGE",
      ...(CATEGORY_SET.has(categoryParam) ? { category: categoryParam } : {}),
      ...(q
        ? {
            OR: [
              { titleAr: { contains: q, mode: "insensitive" } },
              { titleEn: { contains: q, mode: "insensitive" } },
              { tags: { has: q.toLowerCase() } },
            ],
          }
        : {}),
      ...(onlyFavorites && user ? { favorites: { some: { userId: user.id } } } : {}),
    };

    const rows = await db.wallpaper.findMany({
      where,
      orderBy: [{ featured: "desc" }, { sortOrder: "asc" }, { createdAt: "desc" }, { id: "asc" }],
      take: PAGE_SIZE + 1,
      ...(cursor && cursor.length <= 100 ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, titleAr: true, titleEn: true, isVip: true, category: true },
    });

    const hasMore = rows.length > PAGE_SIZE;
    const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

    return NextResponse.json(
      {
        items: page.map((item) => {
          const locked = item.isVip && !isVip;
          return {
            id: item.id,
            title: item.titleAr || item.titleEn || "GameVortex",
            category: item.category,
            isVip: item.isVip,
            locked,
            thumb: locked ? null : `/api/wallpapers/${item.id}/media?thumb=1`,
            src: locked ? null : `/api/wallpapers/${item.id}/media`,
          };
        }),
        nextCursor: hasMore ? page[page.length - 1].id : null,
      },
      { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } },
    );
  } catch (error) {
    return internalError("wallpapers:studio:library", error);
  }
}
