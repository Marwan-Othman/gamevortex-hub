import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { guardRead, ownerRouteError } from "@/lib/api";
import { db } from "@/lib/prisma";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const blocked = await guardRead(request, "admin:users", 60);
  if (blocked) return blocked;
  try {
    await requireOwner();
    const users = await db.user.findMany({ orderBy: { createdAt: "desc" }, take: 250, select: { id: true, username: true, email: true, role: true, points: true, ownerPoints: true, vipTier: true, createdAt: true } });
    return NextResponse.json({ users }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return ownerRouteError(error, "ADMIN_USERS_FAILED", 500);
  }
}
