import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { guardMutation, guardRead } from "@/lib/api";

export async function GET(request: NextRequest, { params }: { params: Promise<{ username: string }> }) {
  const blocked = await guardRead(request, "follow:read"); if (blocked) return blocked;
  try { const me = await requireUser(); const { username } = await params; const target = await db.user.findUnique({ where: { username }, select: { id: true } }); if (!target) return NextResponse.json({ error: "USER_NOT_FOUND" }, { status: 404 }); const follow = await db.userFollow.findUnique({ where: { followerId_followingId: { followerId: me.id, followingId: target.id } } }); return NextResponse.json({ following: Boolean(follow) }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "UNAUTHORIZED" }, { status: 401 }); }
}
export async function POST(request: NextRequest, { params }: { params: Promise<{ username: string }> }) {
  const blocked = await guardMutation(request, "follow", 20); if (blocked) return blocked;
  try { const me = await requireUser(); const { username } = await params; const target = await db.user.findUnique({ where: { username }, select: { id: true, username: true } }); if (!target) return NextResponse.json({ error: "USER_NOT_FOUND" }, { status: 404 }); if (target.id === me.id) return NextResponse.json({ error: "CANNOT_FOLLOW_SELF" }, { status: 400 }); const follow = await db.userFollow.upsert({ where: { followerId_followingId: { followerId: me.id, followingId: target.id } }, create: { followerId: me.id, followingId: target.id }, update: {} }); await db.notification.create({ data: { userId: target.id, type: "NEW_FOLLOWER", title: "New follower", body: `${me.username || me.email} started following you.`, metadata: { followerId: me.id } } }); return NextResponse.json(follow, { status: 201 }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "FOLLOW_FAILED" }, { status: 400 }); }
}
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ username: string }> }) {
  const blocked = await guardMutation(request, "follow", 20); if (blocked) return blocked;
  try { const me = await requireUser(); const { username } = await params; const target = await db.user.findUnique({ where: { username }, select: { id: true } }); if (!target) return NextResponse.json({ error: "USER_NOT_FOUND" }, { status: 404 }); await db.userFollow.deleteMany({ where: { followerId: me.id, followingId: target.id } }); return NextResponse.json({ ok: true }); }
  catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "UNFOLLOW_FAILED" }, { status: 400 }); }
}
