/**
 * GameVortex AI Trading — emergency exit when the protective OCO cannot be confirmed.
 *
 * A filled BUY without a confirmed stop-loss is an unprotected real-money
 * position. This tries ONE market SELL of the sellable quantity. It NEVER
 * throws: the caller must always be able to record the outcome, trip the
 * circuit breaker and require manual review. It does not credit any wallet;
 * accounting for an emergency exit is a separate, verified step.
 */

import { createHash } from "node:crypto";

export type EmergencySellAdapter = {
  placeEmergencyMarketSell?: (request: {
    clientOrderId: string;
    symbol: string;
    quantity: string;
  }) => Promise<{
    accepted: boolean;
    clientOrderId: string;
    providerOrderId?: string;
    status: "REJECTED" | "SUBMITTED" | "FILLED";
    executedQty?: number;
    cumulativeQuoteQty?: number;
  }>;
};

export type EmergencyExitOutcome =
  | {
      status: "SOLD";
      clientOrderId: string;
      providerOrderId: string | null;
      executedQty: number | null;
      cumulativeQuoteQty: number | null;
    }
  | { status: "FAILED"; clientOrderId: string; reason: string };

/** Deterministic id (<= 36 chars, Binance limit) so a retry can never double-sell. */
export function buildEmergencySellClientOrderId(entryClientOrderId: string): string {
  const digest = createHash("sha256").update(`${entryClientOrderId}:emergency-sell`, "utf8").digest("hex");
  return `gv-es-${digest.slice(0, 24)}`;
}

export async function attemptEmergencyExit(input: {
  adapter: EmergencySellAdapter;
  symbol: string;
  entryClientOrderId: string;
  quantity: string;
}): Promise<EmergencyExitOutcome> {
  const clientOrderId = buildEmergencySellClientOrderId(input.entryClientOrderId);
  try {
    if (!input.adapter.placeEmergencyMarketSell) throw new Error("EMERGENCY_SELL_ADAPTER_REQUIRED");
    if (!/^\d+(\.\d+)?$/.test(input.quantity) || Number(input.quantity) <= 0) {
      throw new Error("EMERGENCY_SELL_QUANTITY_INVALID");
    }

    const placed = await input.adapter.placeEmergencyMarketSell({
      clientOrderId,
      symbol: input.symbol,
      quantity: input.quantity,
    });

    if (!placed.accepted || placed.status === "REJECTED") throw new Error("EMERGENCY_SELL_REJECTED");
    return {
      status: "SOLD",
      clientOrderId,
      providerOrderId: placed.providerOrderId ?? null,
      executedQty: placed.executedQty ?? null,
      cumulativeQuoteQty: placed.cumulativeQuoteQty ?? null,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 200) : "EMERGENCY_SELL_FAILED";
    return { status: "FAILED", clientOrderId, reason };
  }
}
