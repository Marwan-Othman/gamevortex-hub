import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth";
import { guardMutation } from "@/lib/api";
import { ensureCategoryIds } from "@/lib/categories";
import { getPlatformEnum } from "@/lib/platforms";
import type { Prisma } from "@prisma/client";

function platforms(value: unknown) { return Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === "string").map(getPlatformEnum).filter((v): v is NonNullable<ReturnType<typeof getPlatformEnum>> => Boolean(v)))] : []; }
function str(v: unknown, max=4000) { return typeof v === "string" ? v.trim().slice(0,max) : null; }

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const blocked = await guardMutation(request, "admin:apps:update", 20); if (blocked) return blocked;
  try {
    const owner = await requireOwner(); const { id } = await context.params; const body = await request.json();
    const data: Prisma.AppUpdateInput = {};
    for (const [key,max] of [["nameAr",180],["nameEn",180],["descriptionAr",4000],["descriptionEn",4000],["developer",180],["publisher",180],["iconUrl",1000],["coverUrl",1000],["officialUrl",1000],["downloadSource",1000],["sourceProvider",120]] as const) if (key in body) (data as Record<string, unknown>)[key] = str(body[key],max);
    if ("published" in body) data.published = body.published === true;
    if ("featured" in body) data.featured = body.featured === true;
    if ("priceCents" in body) data.priceCents = Math.max(0, Number(body.priceCents) || 0);
    if ("discountPercent" in body) data.discountPercent = Math.min(100, Math.max(0, Number(body.discountPercent) || 0));
    if (body.sourceStatus && ["VERIFIED","OFFICIAL_SOURCE","NEEDS_SOURCE","PENDING_REVIEW","UNPUBLISHED"].includes(body.sourceStatus)) data.sourceStatus = body.sourceStatus;
    if ("slug" in body) data.slug = String(body.slug).trim().toLowerCase().replace(/[^a-z0-9-]+/g,"-").replace(/^-+|-+$/g,"");
    const p = platforms(body.platforms);
    const categoryIds = await ensureCategoryIds(db, body.categories ?? body.category ? [body.categories ?? body.category].flat() : []);
    const app = await db.$transaction(async tx => {
      await tx.app.update({ where: { id }, data });
      if ("platforms" in body) { await tx.appPlatform.deleteMany({ where: { appId: id } }); if (p.length) await tx.appPlatform.createMany({ data: p.map(platform => ({ appId:id, platform })), skipDuplicates:true }); }
      if ("categories" in body || "category" in body) { await tx.appCategory.deleteMany({ where: { appId:id } }); if (categoryIds.length) await tx.appCategory.createMany({ data: categoryIds.map(categoryId => ({ appId:id, categoryId })), skipDuplicates:true }); }
      return tx.app.findUnique({ where:{id}, include:{appPlatforms:true, appCategories:{include:{category:true}}} });
    });
    await db.auditLog.create({ data:{ actorUserId:owner.id, action:"APP_UPDATED", entityType:"App", entityId:id, metadata:{ fields:Object.keys(data) } } });
    return NextResponse.json({success:true,data:app});
  } catch(error){ return NextResponse.json({success:false,error:error instanceof Error?error.message:"Failed to update app"},{status:500}); }
}
