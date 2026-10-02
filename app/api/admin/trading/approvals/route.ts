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
    const owner = await requireTradingOwner(); ownerId = owner.id;
    let body: unknown;
    try { body = await request.json(); } catch { throw new Error("INVALID_JSON"); }
    const raw = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const opportunityId = typeof raw.opportunityId === "string" ? raw.opportunityId.trim() : "";
    const strategyVersion = typeof raw.strategyVersion === "string" ? raw.strategyVersion.trim() : undefined;
    const shariahStatus = raw.shariahStatus;
    const amountUsd = typeof raw.amountUsd === "string" || typeof raw.amountUsd === "number" ? raw.amountUsd : undefined;
    const executionSnapshot = raw.executionSnapshot;
    if (!opportunityId) throw new Error("OPPORTUNITY_ID_REQUIRED");
    if (shariahStatus !== "APPROVED") throw new Error("SHARIAH_APPROVAL_REQUIRED");
    if (amountUsd === undefined) throw new Error("INVALID_APPROVAL_AMOUNT");
    if (!executionSnapshot || typeof executionSnapshot !== "object" || Array.isArray(executionSnapshot)) throw new Error("INVALID_EXECUTION_SNAPSHOT");

    const ttlSeconds = raw.ttlSeconds === undefined ? DEFAULT_TTL_SECONDS : Number(raw.ttlSeconds);
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > MAX_TTL_SECONDS) throw new Error("INVALID_APPROVAL_TTL");
    const riskSnapshot = raw.riskSnapshot;
    if (riskSnapshot !== undefined && (riskSnapshot === null || typeof riskSnapshot !== "object" || Array.isArray(riskSnapshot))) throw new Error("INVALID_RISK_SNAPSHOT");

    const { approval, token } = await createOwnerApproval({
      ownerId: owner.id,
      opportunityId,
      amountUsd,
      shariahStatus: "APPROVED",
      strategyVersion,
      riskSnapshot: riskSnapshot as Prisma.JsonObject | undefined,
      executionSnapshot: executionSnapshot as unknown as OwnerExecutionSnapshot,
      ttlSeconds,
    });
    return NextResponse.json({ ok: true, approval: serializeApproval(approval), token: token.token }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "INTERNAL_ERROR";
    if (message === "FORBIDDEN") return tradingForbidden();
    const status = tradingErrorStatus(message);
    if (status) return NextResponse.json({ error: message }, { status });
    const localStatus: Record<string, number> = {
      INVALID_JSON: 400, OPPORTUNITY_ID_REQUIRED: 400, SHARIAH_APPROVAL_REQUIRED: 409,
      INVALID_APPROVAL_TTL: 400, INVALID_RISK_SNAPSHOT: 400, INVALID_APPROVAL_AMOUNT: 400, INVALID_EXECUTION_SNAPSHOT: 400,
    };
    if (localStatus[message]) return NextResponse.json({ error: message }, { status: localStatus[message] });
    await logSystemError("admin:trading:approvals:post", error, { userId: ownerId });
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
