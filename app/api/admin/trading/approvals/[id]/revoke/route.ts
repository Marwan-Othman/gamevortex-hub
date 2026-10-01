import { NextRequest, NextResponse } from "next/server";
import { guardMutation } from "@/lib/api";
import { requireTradingOwner, tradingForbidden } from "@/lib/trading/access";
import { revokeOwnerApproval } from "@/lib/trading/approval-store";
import { logSystemError } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const blocked = await guardMutation(request, "admin:trading:approvals:revoke", 10);
  if (blocked) return blocked;

  let ownerId: string | undefined;
  try {
    const owner = await requireTradingOwner();
    ownerId = owner.id;
    const { id } = await context.params;

    await revokeOwnerApproval({
      ownerId: owner.id,
      approvalId: id,
    });

    return NextResponse.json({ ok: true, revoked: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "INTERNAL_ERROR";
    if (message === "FORBIDDEN") return tradingForbidden();

    const status: Record<string, number> = {
      INVALID_APPROVAL_INPUT: 400,
      APPROVAL_NOT_REVOKABLE: 409,
    };

    if (status[message]) return NextResponse.json({ error: message }, { status: status[message] });

    await logSystemError("admin:trading:approvals:revoke", error, { userId: ownerId });
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
