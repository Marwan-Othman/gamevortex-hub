import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth";
import { guardMutation, guardRead } from "@/lib/api";
import { createApiKey } from "@/lib/gamevortex-api/keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
  email: z.email().trim().max(254),
  label: z.string().trim().min(1).max(80),
});

export async function GET(request: NextRequest) {
  const blocked = await guardRead(request, "admin:api-keys", 30);
  if (blocked) return blocked;

  try {
    await requireOwner();
    const keys = await db.gameVortexApiKey.findMany({
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        userId: true,
        label: true,
        prefix: true,
        createdAt: true,
        lastUsedAt: true,
        revokedAt: true,
        user: { select: { email: true, username: true } },
        _count: { select: { requests: true } },
      },
    });
    return NextResponse.json({ data: keys });
  } catch (error) {
    const message = error instanceof Error ? error.message : "OWNER_API_KEYS_FAILED";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 403 });
  }
}

export async function POST(request: NextRequest) {
  const blocked = await guardMutation(request, "admin:api-keys:create", 10);
  if (blocked) return blocked;

  try {
    const owner = await requireOwner();
    const body = createSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });

    const user = await db.user.findUnique({
      where: { email: body.data.email.toLowerCase() },
      select: { id: true },
    });
    if (!user) return NextResponse.json({ error: "USER_NOT_FOUND" }, { status: 404 });

    const generated = createApiKey();
    const apiKey = await db.$transaction(async (tx) => {
      const created = await tx.gameVortexApiKey.create({
        data: {
          userId: user.id,
          label: body.data.label,
          prefix: generated.prefix,
          secretHash: generated.secretHash,
        },
        select: { id: true, label: true, prefix: true, createdAt: true },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: owner.id,
          action: "OWNER_API_KEY_CREATED",
          entityType: "GameVortexApiKey",
          entityId: created.id,
          metadata: { userId: user.id, label: created.label, prefix: created.prefix },
        },
      });
      return created;
    });

    return NextResponse.json({ data: { ...apiKey, key: generated.key } }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "OWNER_API_KEYS_FAILED";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 500;
    if (status === 500) console.error(JSON.stringify({ event: "owner_api_key_create_failed", requestId: randomUUID() }));
    return NextResponse.json({ error: status === 500 ? "OWNER_API_KEYS_FAILED" : message }, { status });
  }
}