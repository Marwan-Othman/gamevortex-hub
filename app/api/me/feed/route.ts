import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { guardRead } from "@/lib/api";
export async function GET(request: NextRequest) {
  const blocked = await guardRead(request, "feed:read"); if (blocked) return blocked;
  try { const user = await requireUser(); const follows = await db.userFollow.findMany({ where: { followerId: user.id }, select: { followingId: true } }); const ids = [user.id, ...follows.map(x => x.followingId)]; const activities = await db.activity.findMany({ where: { userId: { in: ids } }, include: { user: { select: { id: true, username: true } }, game: { select: { slug: true, titleAr: true, titleEn: true, coverUrl: true } } }, orderBy: { createdAt: "desc" }, take: 50 }); return NextResponse.json(activities); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "UNAUTHORIZED" }, { status: 401 }); }
}
