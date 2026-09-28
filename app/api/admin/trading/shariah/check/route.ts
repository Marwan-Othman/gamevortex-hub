import { NextRequest, NextResponse } from "next/server";
import { guardMutation } from "@/lib/api";
import { requireTradingOwner } from "@/lib/trading/access";
import { parseShariahInput } from "@/lib/trading/shariah-input";
import { checkAndRecordShariah } from "@/lib/trading/shariah-service";
import { readJsonObject, tradingRouteError } from "@/lib/trading/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Evaluates + records a Shariah decision. It never authorizes a trade by itself:
// the Trading Executor re-checks Shariah, Risk, Control and Approval.
export async function POST(request: NextRequest) {
  const blocked = await guardMutation(request, "admin:trading:shariah:check", 20);
  if (blocked) return blocked;

  let ownerId: string | undefined;
  try {
    const owner = await requireTradingOwner();
    ownerId = owner.id;

    const asset = parseShariahInput(await readJsonObject(request));
    const { decision, profileId, auditId } = await checkAndRecordShariah({ actorUserId: owner.id, asset });

    return NextResponse.json({ ok: true, decision, profileId, auditId });
  } catch (error) {
    return tradingRouteError(error, "admin:trading:shariah:check", ownerId);
  }
}
