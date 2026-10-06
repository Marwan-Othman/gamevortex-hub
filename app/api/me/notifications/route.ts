import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { guardMutation, guardRead } from "@/lib/api";

const patchSchema = z.object({
  id: z.string().trim().min(1).max(100).optional(),
});

export async function GET(request: NextRequest) {
  const blocked = await guardRead(request, "notifications:read");
  if (blocked) return blocked;

  try {
    const user = await requireUser();
    const notifications = await db.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    return NextResponse.json(notifications, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "UNAUTHORIZED" },
      { status: 401 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  const blocked = await guardMutation(request, "notifications:write", 30);
  if (blocked) return blocked;

  try {
    const user = await requireUser();
    const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));

    if (!parsed.success) {
      return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
    }

    const readAt = new Date();

    if (parsed.data.id) {
      const result = await db.notification.updateMany({
        where: { id: parsed.data.id, userId: user.id, readAt: null },
        data: { readAt },
      });

      return NextResponse.json({ ok: true, updated: result.count });
    }

    const result = await db.notification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt },
    });

    return NextResponse.json({ ok: true, updated: result.count });
  } catch (error) {
    const message = error instanceof Error ? error.message : "NOTIFICATIONS_UPDATE_FAILED";
    return NextResponse.json(
      { error: message },
      { status: message === "UNAUTHORIZED" ? 401 : 400 },
    );
  }
}
