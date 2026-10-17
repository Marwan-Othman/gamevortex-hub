import { NextResponse } from "next/server";
import { requireTradingOwner } from "@/lib/trading/access";
import { getBinanceLivePreflight } from "@/lib/trading/binance-live-preflight";
import { createLiveExchangeAdapter, getConfiguredLiveExchange } from "@/lib/trading/live-exchange";
import { tradingRouteError } from "@/lib/trading/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only production exchange preflight.
 *
 * This endpoint never creates, modifies, cancels, or withdraws an order. It
 * only verifies server-side credentials and Binance account/API-key safety
 * restrictions needed before a separately reviewed live executor can exist.
 */
export async function GET() {
  let ownerId: string | undefined;
  try {
    const owner = await requireTradingOwner();
    ownerId = owner.id;

    const exchange = getConfiguredLiveExchange();
    if (exchange === "BYBIT") {
      const adapter = createLiveExchangeAdapter();
      if (adapter.id !== "bybit-spot-live" || typeof (adapter as { getLiveReadiness?: unknown }).getLiveReadiness !== "function") {
        throw new Error("BYBIT_LIVE_PREFLIGHT_NOT_IMPLEMENTED");
      }
      const bybit = adapter as typeof adapter & {
        getLiveReadiness: (quoteAsset?: string) => Promise<{
          accountMode: number;
          marginMode: string;
          quoteAsset: string;
          quoteFreeBalance: number;
          blockers: string[];
        }>;
      };
      const readiness = await bybit.getLiveReadiness("USDT");
      return NextResponse.json({
        ok: true,
        venue: "BYBIT_SPOT_LIVE",
        readOnly: true,
        realMoney: false,
        credentialsConfigured: true,
        checks: {
          apiKeyPermissions: true,
          accountMode: true,
          quoteBalance: readiness.quoteFreeBalance > 0,
          withdrawalsDisabled: true,
          spotBorrowDisabled: true,
        },
        readyForLiveExecution: false,
        blockers: [...readiness.blockers, "LIVE_TRADING_ACCOUNTING_NOT_READY", "BYBIT_NATIVE_LINKED_PROTECTION_NOT_IMPLEMENTED"],
        account: {
          accountMode: readiness.accountMode,
          marginMode: readiness.marginMode,
          quoteAsset: readiness.quoteAsset,
          quoteFreeBalance: readiness.quoteFreeBalance,
        },
      });
    }

    const preflight = await getBinanceLivePreflight();
    return NextResponse.json({
      ok: true,
      venue: "BINANCE_SPOT_LIVE",
      readOnly: true,
      realMoney: false,
      ...preflight,
      // Exchange/API checks alone do not prove that GameVortex wallet funding,
      // custody reconciliation, and proceeds settlement are production-ready.
      // Keep this false until the accounting readiness gate is independently verified.
      readyForLiveExecution: false,
      blockers: [...new Set([...preflight.blockers, "LIVE_TRADING_ACCOUNTING_NOT_READY"])],
    });
  } catch (error) {
    return tradingRouteError(error, "admin:trading:exchange:live:preflight:get", ownerId);
  }
}
