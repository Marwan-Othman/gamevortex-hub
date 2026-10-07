import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { guardMutation, guardRead } from "@/lib/api";
import { requireTradingOwner, tradingErrorStatus, tradingForbidden } from "@/lib/trading/access";
import {
  createOwnerApproval,
  type OwnerExecutionSnapshot,
} from "@/lib/trading/approval-store";
import { db } from "@/lib/prisma";
import { logSystemError } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TTL_SECONDS = 15 * 60;
const DEFAULT_TTL_SECONDS = 5 * 60;

function serializeApproval(row: {
  id: string; opportunityId: string; ownerId: string; amountUsd: Prisma.Decimal; issuedAt: Date; expiresAt: Date;
  consumedAt: Date | null; status: string; strategyVersion: string | null; shariahStatus: string;
  riskSnapshot: Prisma.JsonValue | null; executionSnapshot: Prisma.JsonValue | null;
}) {
  return {
    id: row.id, opportunityId: row.opportunityId, ownerId: row.ownerId, amountUsd: row.amountUsd.toString(),
    issuedAt: row.issuedAt.toISOString(), expiresAt: row.expiresAt.toISOString(), consumedAt: row.consumedAt?.toISOString() ?? null,
    status: row.status, strategyVersion: row.strategyVersion, shariahStatus: row.shariahStatus,
    riskSnapshot: row.riskSnapshot, executionSnapshot: row.executionSnapshot,
  };
}

export async function GET(request: NextRequest) {
  const blocked = await guardRead(request, "admin:trading:approvals", 60);
  if (blocked) return blocked;
  let ownerId: string | undefined;
  try {
    const owner = await requireTradingOwner(); ownerId = owner.id;
    const approvals = await db.$queryRaw<Array<{
      id: string; opportunityId: string; ownerId: string; amountUsd: Prisma.Decimal; issuedAt: Date; expiresAt: Date;
      consumedAt: Date | null; status: string; strategyVersion: string | null; shariahStatus: string;
      riskSnapshot: Prisma.JsonValue | null; executionSnapshot: Prisma.JsonValue | null;
    }>>(Prisma.sql`
      SELECT "id", "opportunityId", "ownerId", "amountUsd", "issuedAt", "expiresAt", "consumedAt", "status",
        "strategyVersion", "shariahStatus", "riskSnapshot", "executionSnapshot"
      FROM "TradingApproval" WHERE "ownerId" = ${owner.id} ORDER BY "issuedAt" DESC LIMIT 100
    `);
    return NextResponse.json({ ok: true, approvals: approvals.map(serializeApproval) });
  } catch (error) {
    if (error instanceof Error && error.message === "FORBIDDEN") return tradingForbidden();
    await logSystemError("admin:trading:approvals:get", error, { userId: ownerId });
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const blocked = await guardMutation(request, "admin:trading:approvals", 10);
  if (blocked) return blocked;

  let ownerId: string | undefined;
  try {
    const owner = await requireTradingOwner();
    ownerId = owner.id;

    /*
     * Raw client-created approvals are deliberately disabled.
     *
     * An approval is a security boundary: its Shariah decision, risk
     * snapshot, market snapshot and funding checks must be produced by the
     * server-side trading pipeline. Accepting those snapshots from the
     * browser would allow a caller to manufacture an APPROVED opportunity.
     *
     * The supported flow is:
     *   /live/prepare -> /approvals/:id/consume -> /live/execute
     * or the server-side paper-opportunity pipeline.
     */
    await db.auditLog.create({
      data: {
        actorUserId: owner.id,
        action: "TRADING_RAW_APPROVAL_CREATION_BLOCKED",
        entityType: "TradingApproval",
        metadata: {
          reason: "CLIENT_SUPPLIED_APPROVAL_SNAPSHOTS_NOT_ALLOWED",
        },
      },
    });

    return NextResponse.json(
      { error: "RAW_APPROVAL_CREATION_DISABLED" },
      { status: 410 },
    );
  } catch (error) {
    if (error instanceof Error && error.message === "FORBIDDEN") {
      return tradingForbidden();
    }
    await logSystemError("admin:trading:approvals:post", error, { userId: ownerId });
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
