import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth";
import { guardMutation } from "@/lib/api";
import { ensureCategoryIds } from "@/lib/categories";
import { getPlatformEnum } from "@/lib/platforms";

export const dynamic = "force-dynamic";

function platforms(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((v): v is string => typeof v === "string").map(getPlatformEnum).filter((v): v is NonNullable<ReturnType<typeof getPlatformEnum>> => Boolean(v)))];
}
function clean(value: unknown, max = 4000) { return typeof value === "string" ? value.trim().slice(0, max) : null; }

export async function GET(request: NextRequest) {
  try {
    await requireOwner();
    const search = request.nextUrl.searchParams.get("search")?.trim() || "";
    const apps = await db.app.findMany({
      where: search ? { OR: [{ nameAr: { contains: search, mode: "insensitive" } }, { nameEn: { contains: search, mode: "insensitive" } }, { slug: { contains: search, mode: "insensitive" } }] } : undefined,
      orderBy: { updatedAt: "desc" },
      include: { appPlatforms: true, appCategories: { include: { category: true } } },
    });
    return NextResponse.json({ success: true, data: apps });
  } catch { return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 }); }
}

export async function POST(request: NextRequest) {
  const blocked = await guardMutation(request, "admin:apps:create", 20);
  if (blocked) return blocked;
  try {
    const owner = await requireOwner();
    const body = await request.json();
    const nameAr = clean(body.nameAr, 180), nameEn = clean(body.nameEn, 180), slug = clean(body.slug, 120);
    if (!nameAr || !nameEn || !slug) return NextResponse.json({ success: false, error: "nameAr, nameEn and slug are required" }, { status: 400 });
    const appPlatforms = platforms(body.platforms);
    const categoryIds = await ensureCategoryIds(db, body.categories ?? body.category ? [body.categories ?? body.category].flat() : []);
    const app = await db.app.create({ data: {
      nameAr, nameEn, slug: slug.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, ""),
      descriptionAr: clean(body.descriptionAr), descriptionEn: clean(body.descriptionEn), developer: clean(body.developer, 180), publisher: clean(body.publisher, 180), iconUrl: clean(body.iconUrl, 1000), coverUrl: clean(body.coverUrl, 1000), officialUrl: clean(body.officialUrl, 1000), downloadSource: clean(body.downloadSource, 1000), sourceStatus: body.sourceStatus === "VERIFIED" || body.sourceStatus === "OFFICIAL_SOURCE" ? body.sourceStatus : "NEEDS_SOURCE", sourceProvider: clean(body.sourceProvider, 120), priceCents: Math.max(0, Number(body.priceCents) || 0), discountPercent: Math.min(100, Math.max(0, Number(body.discountPercent) || 0)), published: body.published === true, featured: body.featured === true,
      appPlatforms: { create: appPlatforms.map(platform => ({ platform })) }, appCategories: { create: categoryIds.map(categoryId => ({ categoryId })) },
    }, include: { appPlatforms: true, appCategories: { include: { category: true } } } });
    await db.auditLog.create({ data: { actorUserId: owner.id, action: "APP_CREATED", entityType: "App", entityId: app.id, metadata: { slug: app.slug } } });
    return NextResponse.json({ success: true, data: app }, { status: 201 });
  } catch (error) { return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Failed to create app" }, { status: 500 }); }
}
