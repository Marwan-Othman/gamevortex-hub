import { NextRequest, NextResponse } from "next/server";
import { guardRead } from "@/lib/api";
import { requireTradingOwner, tradingForbidden } from "@/lib/trading/access";
import { getTradingExchangeAdapter, getTradingExchangeConfig } from "@/lib/trading/exchange-config";
import { logSystemError } from "@/lib/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const blocked = await guardRead(request, "admin:trading:exchange", 60);
  if (blocked) return blocked;

  let ownerId: string | undefined;
  try {
    const owner = await requireTradingOwner();
    ownerId = owner.id;

    const config = getTradingExchangeConfig();
    const adapter = getTradingExchangeAdapter();

    return NextResponse.json({
      ok: true,
      exchange: {
        provider: config.provider,
        mode: config.mode,
        liveTradingEnabled: config.liveTradingEnabled,
        capabilities: adapter.getCapabilities(),
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "FORBIDDEN") return tradingForbidden();

    if (error instanceof Error && error.message === "LIVE_TRADING_NOT_ENABLED") {
      return NextResponse.json(
        { ok: false, error: "LIVE_TRADING_NOT_ENABLED" },
        { status: 503 },
      );
    }

    await logSystemError("admin:trading:exchange", error, { userId: ownerId });
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
