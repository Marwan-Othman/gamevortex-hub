import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/prisma";
import { guardRead } from "@/lib/api";
import { toPublicContent } from "@/lib/downloads";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const blocked = await guardRead(request, "apps:detail", 120);
  if (blocked) return blocked;

  try {
    const { slug } = await context.params;
    if (!slug || slug.length > 160) return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    const app = await db.app.findFirst({ where: { slug, published: true }, include: { appPlatforms: true, appCategories: { include: { category: true } } } });
    if (!app) return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    // A failed counter update must never break the page itself.
    await db.app.update({ where: { id: app.id }, data: { viewCount: { increment: 1 } } }).catch(() => undefined);
    return NextResponse.json({ success: true, data: toPublicContent(app) });
  } catch (error) {
    console.error("GET /api/apps/[slug]", error);
    return NextResponse.json({ success: false, error: "Failed to load app" }, { status: 500 });
  }
}
