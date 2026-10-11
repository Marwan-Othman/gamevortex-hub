import { NextRequest, NextResponse } from "next/server";
import { getOptionalUser } from "@/lib/auth";
import { guardRead, internalError } from "@/lib/api";
import { db } from "@/lib/prisma";
import { getProviderHealth } from "@/lib/ai/provider-manager";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const blocked = await guardRead(request, "ai:admin:health", 30);
  if (blocked) return blocked;
  let user: Awaited<ReturnType<typeof getOptionalUser>>;
  try {
    user = await getOptionalUser();
  } catch (error) {
    return internalError("ai:admin:health:auth", error, "AI_HEALTH_FAILED");
  }
  // Signed out -> 401; signed in but not the owner -> 403 (the UI can tell "log in" from "not allowed").
  if (!user) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });

  try {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [health, total, completed, failed, fallbacks, usage] = await Promise.all([
    getProviderHealth(),
    db.aiUsageLedger.count({ where: { createdAt: { gte: since } } }),
    db.aiUsageLedger.count({ where: { createdAt: { gte: since }, status: "COMPLETED" } }),
    db.aiUsageLedger.count({ where: { createdAt: { gte: since }, status: "FAILED" } }),
    db.aiUsageLedger.groupBy({ by: ["requestId"], where: { createdAt: { gte: since }, status: "FAILED", requestId: { not: null } }, _count: { _all: true } }),
    db.aiUsageLedger.groupBy({ by: ["provider"], where: { createdAt: { gte: since } }, _count: { _all: true }, _sum: { gvcUsed: true } }),
  ]);

  return NextResponse.json({
    period: "24h",
    health,
    requests: { total, completed, failed },
    fallbackCount: fallbacks.filter(item => (item._count._all || 0) > 1).length,
    providerUsage: usage.map(item => ({ provider: item.provider, requests: item._count._all, credits: item._sum.gvcUsed || 0 })),
  });
  } catch (error) {
    return internalError("ai:admin:health", error, "AI_HEALTH_FAILED");
  }
}
