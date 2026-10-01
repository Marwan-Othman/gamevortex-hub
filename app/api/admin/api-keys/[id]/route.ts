import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth";
import { guardMutation } from "@/lib/api";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const blocked = await guardMutation(request, "admin:api-keys:revoke", 20);
  if (blocked) return blocked;

  try {
    const owner = await requireOwner();
    const { id } = await context.params;
    z.string().cuid().parse(id);
    const existing = await db.gameVortexApiKey.findUnique({ where: { id }, select: { id: true, revokedAt: true, userId: true } });
    if (!existing) return NextResponse.json({ error: "API_KEY_NOT_FOUND" }, { status: 404 });
    if (existing.revokedAt) return NextResponse.json({ ok: true, revoked: true });

    await db.$transaction(async (tx) => {
      await tx.gameVortexApiKey.update({ where: { id }, data: { revokedAt: new Date() } });
      await tx.auditLog.create({
        data: {
          actorUserId: owner.id,
          action: "OWNER_API_KEY_REVOKED",
          entityType: "GameVortexApiKey",
          entityId: id,
          metadata: { userId: existing.userId },
        },
      });
    });
    return NextResponse.json({ ok: true, revoked: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "OWNER_API_KEY_REVOKE_FAILED";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : message === "API_KEY_NOT_FOUND" ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}