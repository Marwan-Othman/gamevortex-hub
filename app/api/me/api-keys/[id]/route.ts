import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { guardMutation } from "@/lib/api";

export const runtime = "nodejs";

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const blocked = await guardMutation(request, "me:api-keys:revoke", 10);
  if (blocked) return blocked;
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const updated = await db.gameVortexApiKey.updateMany({
      where: { id, userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (!updated.count) return NextResponse.json({ error: "API_KEY_NOT_FOUND" }, { status: 404 });
    return NextResponse.json({ ok: true, revoked: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "API_KEY_REVOKE_FAILED";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 500 });
  }
}