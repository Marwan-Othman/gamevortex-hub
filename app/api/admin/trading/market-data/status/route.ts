import { NextRequest, NextResponse } from "next/server";
import { guardRead } from "@/lib/api";
import { requireTradingOwner, tradingForbidden } from "@/lib/trading/access";
import { createMarketDataProvider } from "@/lib/trading/market-data";
import { logSystemError } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const blocked = await guardRead(request, "admin:trading:market-data-status", 60);
  if (blocked) return blocked;

  let ownerId: string | undefined;
  try {
    const owner = await requireTradingOwner();
    ownerId = owner.id;

    const provider = createMarketDataProvider();

    return NextResponse.json({
      ok: true,
      provider: provider.id,
      capabilities: provider.getCapabilities(),
      configured: provider.getCapabilities().length > 0,
      executionEnabled: false,
      withdrawalsEnabled: false,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "FORBIDDEN") return tradingForbidden();
    await logSystemError("admin:trading:market-data-status", error, { userId: ownerId });
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
