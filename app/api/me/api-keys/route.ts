import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { guardMutation, guardRead } from "@/lib/api";
import { createApiKey } from "@/lib/gamevortex-api/keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({ label: z.string().trim().min(1).max(80) });
const MAX_ACTIVE_KEYS = 3;

export async function GET(request: NextRequest) {
  const blocked = await guardRead(request, "me:api-keys", 30);
  if (blocked) return blocked;
  try {
    const user = await requireUser();
    const [purchase, latestPurchase, keys] = await Promise.all([
      db.apiAccessPurchase.findFirst({ where: { userId: user.id, status: "SUCCEEDED" }, select: { id: true, completedAt: true }, orderBy: { completedAt: "desc" } }),
      db.apiAccessPurchase.findFirst({ where: { userId: user.id }, select: { status: true }, orderBy: { createdAt: "desc" } }),
      db.gameVortexApiKey.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, select: { id: true, label: true, prefix: true, createdAt: true, lastUsedAt: true, revokedAt: true, requiresPurchase: true } }),
    ]);
    return NextResponse.json({ data: { purchased: Boolean(purchase), paymentStatus: latestPurchase?.status || null, keys, activeKeyLimit: MAX_ACTIVE_KEYS } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "API_KEYS_FAILED";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 500 });
  }
}

export async function POST(request: NextRequest) {
  const blocked = await guardMutation(request, "me:api-keys:create", 5);
  if (blocked) return blocked;
  try {
    const user = await requireUser();
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });

    const generated = createApiKey();
    const apiKey = await db.$transaction(async (tx) => {
      const purchase = await tx.apiAccessPurchase.findFirst({ where: { userId: user.id, status: "SUCCEEDED" }, select: { id: true } });
      if (!purchase) throw new Error("API_ACCESS_REQUIRED");
      const activeCount = await tx.gameVortexApiKey.count({ where: { userId: user.id, requiresPurchase: true, revokedAt: null } });
      if (activeCount >= MAX_ACTIVE_KEYS) throw new Error("API_KEY_LIMIT_REACHED");
      return tx.gameVortexApiKey.create({
        data: { userId: user.id, label: parsed.data.label, prefix: generated.prefix, secretHash: generated.secretHash, requiresPurchase: true },
        select: { id: true, label: true, prefix: true, createdAt: true },
      });
    }, { isolationLevel: "Serializable" });

    return NextResponse.json({ data: { ...apiKey, key: generated.key } }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "API_KEY_CREATE_FAILED";
    const status = message === "UNAUTHORIZED" ? 401 : message === "API_ACCESS_REQUIRED" ? 403 : message === "API_KEY_LIMIT_REACHED" ? 409 : 500;
    return NextResponse.json({ error: status === 500 ? "API_KEY_CREATE_FAILED" : message }, { status });
  }
}