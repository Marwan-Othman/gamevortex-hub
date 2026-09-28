import { NextRequest, NextResponse } from "next/server";
import { guardRead } from "@/lib/api";
import { requireTradingOwner, tradingForbidden } from "@/lib/trading/access";
import { getTradingSummary } from "@/lib/trading/allocation";
import { logSystemError } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const blocked = await guardRead(request, "admin:trading:status", 60);
  if (blocked) return blocked;

  let ownerId: string | undefined;
  try {
    const owner = await requireTradingOwner();
    ownerId = owner.id;
    const summary = await getTradingSummary(owner.id);
    return NextResponse.json({ ok: true, ...summary });
  } catch (error) {
    if (error instanceof Error && error.message === "FORBIDDEN") return tradingForbidden();
    await logSystemError("admin:trading:status", error, { userId: ownerId });
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
