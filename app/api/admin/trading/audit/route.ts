import { NextRequest, NextResponse } from "next/server";
import { guardRead } from "@/lib/api";
import { requireTradingOwner } from "@/lib/trading/access";
import { db } from "@/lib/prisma";
import { tradingRouteError } from "@/lib/trading/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TRADING_ACTIONS = [
  "TRADING_",
  "PAPER_",
  "TRADING_EXECUTION_",
  "TRADING_SETTLEMENT_",
  "TRADING_RECONCILIATION_",
];

function isTradingAction(action: string): boolean {
  return TRADING_ACTIONS.some((prefix) => action.startsWith(prefix));
}

export async function GET(request: NextRequest) {
  const blocked = await guardRead(request, "admin:trading:audit", 60);
  if (blocked) return blocked;

  let ownerId: string | undefined;
  try {
    const owner = await requireTradingOwner();
    ownerId = owner.id;

    const rawLimit = Number(request.nextUrl.searchParams.get("limit") ?? "50");
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 100) : 50;

    const logs = await db.auditLog.findMany({
      where: {
        OR: [
          { actorUserId: owner.id },
          { entityType: "TradingControl" },
          { entityType: "TradingExecution" },
          { entityType: "TradingSettlement" },
          { entityType: "TradingReconciliation" },
          { entityType: "TradingPaperSession" },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: Math.min(limit * 3, 300),
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        metadata: true,
        createdAt: true,
      },
    });

    const entries = logs
      .filter((log) => isTradingAction(log.action))
      .slice(0, limit)
      .map((log) => ({
        id: log.id,
        action: log.action,
        entityType: log.entityType,
        entityId: log.entityId,
        metadata: log.metadata,
        createdAt: log.createdAt.toISOString(),
      }));

    return NextResponse.json({ ok: true, entries });
  } catch (error) {
    return tradingRouteError(error, "admin:trading:audit:get", ownerId);
  }
}
