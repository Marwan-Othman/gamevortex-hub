import { NextResponse } from "next/server";
import { db } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(_: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const app = await db.app.findFirst({ where: { slug, published: true }, include: { appPlatforms: true, appCategories: { include: { category: true } } } });
  if (!app) return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  await db.app.update({ where: { id: app.id }, data: { viewCount: { increment: 1 } } });
  return NextResponse.json({ success: true, data: app });
}
