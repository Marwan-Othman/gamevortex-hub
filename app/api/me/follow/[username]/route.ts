import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { guardMutation, guardRead, userRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ username: string }> };

function validUsername(value: string) {
  return value.length >= 1 && value.length <= 64;
}

export async function GET(request: NextRequest, { params }: Ctx) {
  const blocked = await guardRead(request, "follow:read");
  if (blocked) return blocked;
  try {
    const me = await requireUser();
    const { username } = await params;
    if (!validUsername(username)) return NextResponse.json({ error: "USER_NOT_FOUND" }, { status: 404 });
    const target = await db.user.findUnique({ where: { username }, select: { id: true } });
    if (!target) return NextResponse.json({ error: "USER_NOT_FOUND" }, { status: 404 });
    const follow = await db.userFollow.findUnique({
      where: { followerId_followingId: { followerId: me.id, followingId: target.id } },
    });
    return NextResponse.json({ following: Boolean(follow) });
  } catch (error) {
    return userRouteError(error, "FOLLOW_STATUS_FAILED");
  }
}

export async function POST(request: NextRequest, { params }: Ctx) {
  const blocked = await guardMutation(request, "follow", 20);
  if (blocked) return blocked;
  try {
    const me = await requireUser();
    const { username } = await params;
    if (!validUsername(username)) return NextResponse.json({ error: "USER_NOT_FOUND" }, { status: 404 });
    const target = await db.user.findUnique({ where: { username }, select: { id: true } });
    if (!target) return NextResponse.json({ error: "USER_NOT_FOUND" }, { status: 404 });
    if (target.id === me.id) return NextResponse.json({ error: "CANNOT_FOLLOW_SELF" }, { status: 400 });

    const key = { followerId_followingId: { followerId: me.id, followingId: target.id } };
    const existed = await db.userFollow.findUnique({ where: key });
    const follow = await db.userFollow.upsert({
      where: key,
      create: { followerId: me.id, followingId: target.id },
      update: {},
    });

    // Notify only on a genuinely new follow, and only once per follower: repeating
    // follow -> unfollow -> follow must not become a notification-spam channel.
    // The follower's e-mail address is never put in the notification text.
    if (!existed) {
      const alreadyNotified = await db.notification.findFirst({
        where: { userId: target.id, type: "NEW_FOLLOWER", metadata: { path: ["followerId"], equals: me.id } },
        select: { id: true },
      });
      if (!alreadyNotified) {
        await db.notification.create({
          data: {
            userId: target.id,
            type: "NEW_FOLLOWER",
            title: "New follower",
            body: `${me.username || "A GameVortex player"} started following you.`,
            metadata: { followerId: me.id },
          },
        });
      }
    }

    return NextResponse.json(follow, { status: existed ? 200 : 201 });
  } catch (error) {
    return userRouteError(error, "FOLLOW_FAILED");
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const blocked = await guardMutation(request, "follow", 20);
  if (blocked) return blocked;
  try {
    const me = await requireUser();
    const { username } = await params;
    if (!validUsername(username)) return NextResponse.json({ error: "USER_NOT_FOUND" }, { status: 404 });
    const target = await db.user.findUnique({ where: { username }, select: { id: true } });
    if (!target) return NextResponse.json({ error: "USER_NOT_FOUND" }, { status: 404 });
    await db.userFollow.deleteMany({ where: { followerId: me.id, followingId: target.id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return userRouteError(error, "UNFOLLOW_FAILED");
  }
}
