import { NextRequest, NextResponse } from "next/server";
import { guardMutation, guardRead } from "@/lib/api";
import { requireTradingOwner } from "@/lib/trading/access";
import { parseRiskConfigInput } from "@/lib/trading/risk-config";
import { getRiskConfig, saveRiskConfig } from "@/lib/trading/risk-config-service";
import { readJsonObject, tradingRouteError } from "@/lib/trading/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const blocked = await guardRead(request, "admin:trading:risk-config", 60);
  if (blocked) return blocked;

  let ownerId: string | undefined;
  try {
    const owner = await requireTradingOwner();
    ownerId = owner.id;
    const current = await getRiskConfig(owner.id);
    return NextResponse.json({ ok: true, riskConfig: current });
  } catch (error) {
    return tradingRouteError(error, "admin:trading:risk-config:get", ownerId);
  }
}

export async function PUT(request: NextRequest) {
  const blocked = await guardMutation(request, "admin:trading:risk-config", 10);
  if (blocked) return blocked;

  let ownerId: string | undefined;
  try {
    const owner = await requireTradingOwner();
    ownerId = owner.id;

    const config = parseRiskConfigInput(await readJsonObject(request));
    const saved = await saveRiskConfig({ ownerId: owner.id, config });
    return NextResponse.json({ ok: true, riskConfig: saved });
  } catch (error) {
    return tradingRouteError(error, "admin:trading:risk-config:put", ownerId);
  }
}
