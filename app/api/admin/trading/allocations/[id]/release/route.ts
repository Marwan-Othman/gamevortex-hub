import { NextRequest, NextResponse } from "next/server";
import { guardMutation } from "@/lib/api";
import { requireTradingOwner, tradingErrorStatus, tradingForbidden } from "@/lib/trading/access";
import { releaseAllocation } from "@/lib/trading/allocation";
import { logSystemError } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const blocked = await guardMutation(request, "admin:trading:release", 10);
  if (blocked) return blocked;

  let ownerId: string | undefined;
  try {
    const owner = await requireTradingOwner();
    ownerId = owner.id;
    const { id } = await context.params;

    const result = await releaseAllocation({ ownerId: owner.id, allocationId: id });
    return NextResponse.json({
      ok: true,
      allocationId: result.allocationId,
      amountUsd: result.amountUsd,
      returnedToWallet: result.returnedToWallet,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "INTERNAL_ERROR";
    if (message === "FORBIDDEN") return tradingForbidden();
    const status = tradingErrorStatus(message);
    if (status) return NextResponse.json({ error: message }, { status });
    await logSystemError("admin:trading:release", error, { userId: ownerId });
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
