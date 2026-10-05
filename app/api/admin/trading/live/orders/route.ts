import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { guardMutation, guardRead } from "@/lib/api";
import { db } from "@/lib/prisma";
import { requireTradingOwner } from "@/lib/trading/access";
import { liveRouteError } from "@/lib/trading/live-route-errors";
import { executeApprovedLiveOrder } from "@/lib/trading/live-production-executor";
import { readJsonObject } from "@/lib/trading/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type OrderRow = {
  id: string;
  approvalId: string;
  opportunityId: string;
  symbol: string;
  amountUsd: Prisma.Decimal;
  status: string;
  protectionStatus: string;
  settlementStatus: string;
  averageFillPrice: Prisma.Decimal | null;
  executedQty: Prisma.Decimal | null;
  realizedPnlUsd: Prisma.Decimal | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function serialize(row: OrderRow) {
  return {
    id: row.id,
    symbol: row.symbol,
    amountUsd: row.amountUsd.toString(),
    status: row.status,
    protectionStatus: row.protectionStatus,
    settlementStatus: row.settlementStatus,
    averageFillPrice: row.averageFillPrice?.toString() ?? null,
    executedQty: row.executedQty?.toString() ?? null,
    realizedPnlUsd: row.realizedPnlUsd?.toString() ?? null,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** GET: the owner's most recent live orders (never exposes approval ids or tokens). */
export async function GET(request: NextRequest) {
  const blocked = await guardRead(request, "admin:trading:live:orders", 60);
  if (blocked) return blocked;

  let ownerId: string | undefined;
  try {
    const owner = await requireTradingOwner();
    ownerId = owner.id;

    const rows = await db.$queryRaw<OrderRow[]>(Prisma.sql`
      SELECT "id", "approvalId", "opportunityId", "symbol", "amountUsd", "status", "protectionStatus",
             "settlementStatus", "averageFillPrice", "executedQty", "realizedPnlUsd", "lastError",
             "createdAt", "updatedAt"
      FROM "TradingLiveOrder"
      WHERE "ownerId" = ${owner.id}
      ORDER BY "createdAt" DESC
      LIMIT 10
    `);

    return NextResponse.json({ ok: true, orders: rows.map(serialize) });
  } catch (error) {
    return liveRouteError(error, "admin:trading:live:orders:get", ownerId);
  }
}

/**
 * POST { orderId }: refresh one existing order. Runs the executor in
 * "monitor" mode, which can never submit a BUY; it only reconciles, protects
 * and settles. Works after the approval window has ended.
 */
export async function POST(request: NextRequest) {
  const blocked = await guardMutation(request, "admin:trading:live:orders", 10);
  if (blocked) return blocked;

  let ownerId: string | undefined;
  try {
    const owner = await requireTradingOwner();
    ownerId = owner.id;
    const body = await readJsonObject(request);
    const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
    if (!orderId) throw new Error("INVALID_LIVE_ORDER_INPUT");

    if (process.env.GAMEVORTEX_LIVE_TRADING_ENABLED !== "true") throw new Error("GAMEVORTEX_LIVE_TRADING_DISABLED");

    const rows = await db.$queryRaw<Array<{ approvalId: string; opportunityId: string }>>(Prisma.sql`
      SELECT "approvalId", "opportunityId" FROM "TradingLiveOrder"
      WHERE "id" = ${orderId} AND "ownerId" = ${owner.id}
      LIMIT 1
    `);
    const order = rows[0];
    if (!order) throw new Error("LIVE_ORDER_NOT_FOUND");

    const result = await executeApprovedLiveOrder({
      ownerId: owner.id,
      approvalId: order.approvalId,
      opportunityId: order.opportunityId,
      mode: "monitor",
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return liveRouteError(error, "admin:trading:live:orders:post", ownerId);
  }
}
