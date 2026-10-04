import { NextResponse } from "next/server";
import { requireTradingOwner } from "@/lib/trading/access";
import { getBinanceSpotTestnetAdapter } from "@/lib/trading/binance-spot-testnet-config";
import { tradingRouteError } from "@/lib/trading/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let ownerId: string | undefined;
  try {
    const owner = await requireTradingOwner();
    ownerId = owner.id;

    const adapter = getBinanceSpotTestnetAdapter();
    const account = await adapter.getAccountStatus();
    const isSpotAccount = account.accountType === "SPOT";
    const hasSpotPermission = account.permissions.includes("SPOT");
    const readyForTestnetOrder =
      isSpotAccount &&
      account.canTrade &&
      !account.canWithdraw &&
      hasSpotPermission;

    return NextResponse.json({
      ok: true,
      venue: "BINANCE_SPOT_TESTNET",
      testnetOnly: true,
      realMoney: false,
      readyForTestnetOrder,
      account: {
        canTrade: account.canTrade,
        canWithdraw: account.canWithdraw,
        canDeposit: account.canDeposit,
        accountType: account.accountType,
        permissions: account.permissions,
      },
    });
  } catch (error) {
    return tradingRouteError(error, "admin:trading:exchange:testnet:status:get", ownerId);
  }
}
