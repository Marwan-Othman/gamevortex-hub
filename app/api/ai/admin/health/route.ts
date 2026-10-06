import { NextRequest, NextResponse } from "next/server";
import { getOptionalUser } from "@/lib/auth";
import { guardRead } from "@/lib/api";
import { db } from "@/lib/prisma";
import { getProviderHealth } from "@/lib/ai/provider-manager";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const blocked = await guardRead(request, "ai:admin:health", 30);
  if (blocked) return blocked;
  const user = await getOptionalUser();
  if (!user || user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

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
}
