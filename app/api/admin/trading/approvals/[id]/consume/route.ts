import { NextRequest, NextResponse } from "next/server";
import { guardMutation } from "@/lib/api";
import { requireTradingOwner, tradingForbidden } from "@/lib/trading/access";
import { consumeOwnerApproval } from "@/lib/trading/approval-store";
import { logSystemError } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const blocked = await guardMutation(request, "admin:trading:approvals:consume", 10);
  if (blocked) return blocked;

  let ownerId: string | undefined;
  try {
    const owner = await requireTradingOwner();
    ownerId = owner.id;
    const { id } = await context.params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new Error("INVALID_JSON");
    }

    const raw = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const opportunityId = typeof raw.opportunityId === "string" ? raw.opportunityId.trim() : "";
    const token = typeof raw.token === "string" ? raw.token.trim() : "";

    if (!opportunityId) throw new Error("OPPORTUNITY_ID_REQUIRED");
    if (!token) throw new Error("APPROVAL_TOKEN_REQUIRED");

    const approval = await consumeOwnerApproval({
      ownerId: owner.id,
      approvalId: id,
      opportunityId,
      token,
    });

    return NextResponse.json({
      ok: true,
      approval: {
        id: approval.id,
        opportunityId: approval.opportunityId,
        amountUsd: approval.amountUsd.toString(),
        status: approval.status,
        consumedAt: approval.consumedAt?.toISOString() ?? null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "INTERNAL_ERROR";
    if (message === "FORBIDDEN") return tradingForbidden();

    const status: Record<string, number> = {
      INVALID_JSON: 400,
      OPPORTUNITY_ID_REQUIRED: 400,
      APPROVAL_TOKEN_REQUIRED: 400,
      APPROVAL_NOT_FOUND: 404,
      APPROVAL_ALREADY_CONSUMED: 409,
      APPROVAL_EXPIRED: 409,
      INVALID_APPROVAL_TOKEN: 409,
      APPROVAL_NOT_CONSUMABLE: 409,
    };

    if (status[message]) return NextResponse.json({ error: message }, { status: status[message] });

    await logSystemError("admin:trading:approvals:consume", error, { userId: ownerId });
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
