import { NextRequest, NextResponse } from "next/server";
import { getOptionalUser } from "@/lib/auth";
import { guardMutation, guardRead } from "@/lib/api";
import { db } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const blocked = await guardRead(request, "gamevortex-ai:conversations", 60); if (blocked) return blocked;
  const user = await getOptionalUser(); if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const data = await db.gameVortexAiConversation.findMany({ where: { userId: user.id }, orderBy: { updatedAt: "desc" }, take: 50, select: { id: true, title: true, updatedAt: true } });
  return NextResponse.json({ data });
}
export async function POST(request: NextRequest) {
  const blocked = await guardMutation(request, "gamevortex-ai:conversation:create", 20); if (blocked) return blocked;
  const user = await getOptionalUser(); if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim().slice(0, 100) : "New conversation";
  const data = await db.gameVortexAiConversation.create({ data: { userId: user.id, title: title || "New conversation" } });
  return NextResponse.json({ data }, { status: 201 });
}
