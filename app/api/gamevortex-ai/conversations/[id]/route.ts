import { NextRequest, NextResponse } from "next/server";
import { getOptionalUser } from "@/lib/auth";
import { guardMutation, guardRead } from "@/lib/api";
import { db } from "@/lib/prisma";
export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, { params }: Ctx) {
  const blocked = await guardRead(request, "gamevortex-ai:conversation:read", 60); if (blocked) return blocked;
  const user = await getOptionalUser(); if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { id } = await params; const data = await db.gameVortexAiConversation.findFirst({ where: { id, userId: user.id }, include: { messages: { orderBy: { createdAt: "asc" }, take: 100 } } });
  return data ? NextResponse.json({ data }) : NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
}
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const blocked = await guardMutation(request, "gamevortex-ai:conversation:rename", 30); if (blocked) return blocked;
  const user = await getOptionalUser(); if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || (body.title === undefined && body.systemInstructions === undefined)) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  if (body.title !== undefined && (typeof body.title !== "string" || !body.title.trim() || body.title.length > 100)) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  if (body.systemInstructions !== undefined && (typeof body.systemInstructions !== "string" || body.systemInstructions.length > 2000)) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  const data = { ...(body.title !== undefined ? { title: body.title.trim() } : {}), ...(body.systemInstructions !== undefined ? { systemInstructions: body.systemInstructions.trim() || null } : {}) };
  const { id } = await params; const result = await db.gameVortexAiConversation.updateMany({ where: { id, userId: user.id }, data });
  return result.count ? NextResponse.json({ success: true }) : NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
}
export async function DELETE(request: NextRequest, { params }: Ctx) {
  const blocked = await guardMutation(request, "gamevortex-ai:conversation:delete", 30); if (blocked) return blocked;
  const user = await getOptionalUser(); if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const { id } = await params; const result = await db.gameVortexAiConversation.deleteMany({ where: { id, userId: user.id } });
  return result.count ? NextResponse.json({ success: true }) : NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
}
