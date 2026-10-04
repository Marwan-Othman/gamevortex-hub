import { Prisma } from "@prisma/client";
import { db } from "@/lib/prisma";
import type {
  ExchangeAdapter,
  ExchangeProtectedExitLegStatusResult,
} from "@/lib/trading/exchange-adapter";
import type { LiveOrderRow } from "@/lib/trading/live-order-state";
import { reconcileLiveSpotFees } from "@/lib/trading/live-fee-accounting";

const QUANTITY_TOLERANCE = new Prisma.Decimal("0.000000000001");

type TradeFill = {
  price: string;
  qty: string;
  quoteQty: string;
  commission: string;
  commissionAsset: string;
  time: number;
  isBuyer: boolean;
};

type TradeFillResult = {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  fills: readonly TradeFill[];
};

type TradeFillAdapter = ExchangeAdapter & {
  getOrderTradeFills?: (request: { symbol: string; providerOrderId: string }) => Promise<TradeFillResult>;
};

export type LiveExitSettlementStatus =
  | "NOT_SETTLED"
  | "EXCHANGE_OPEN"
  | "EXCHANGE_CLOSED_PENDING_WALLET"
  | "BLOCKED";

export type LiveExitSettlementResult = {
  order: LiveOrderRow;
  status: LiveExitSettlementStatus;
  exitPrice: string | null;
  realizedPnlUsd: string | null;
  blockers: string[];
};

function decimal(value: string | number | Prisma.Decimal, code: string): Prisma.Decimal {
  let parsed: Prisma.Decimal;
  try {
    parsed = value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
  } catch {
    throw new Error(code);
  }
  if (!parsed.isFinite() || parsed.lessThan(0)) throw new Error(code);
  return parsed;
}

function almostAtLeast(actual: Prisma.Decimal, expected: Prisma.Decimal): boolean {
  return actual.add(QUANTITY_TOLERANCE).greaterThanOrEqualTo(expected);
}

function almostGreater(actual: Prisma.Decimal, expected: Prisma.Decimal): boolean {
  return actual.sub(QUANTITY_TOLERANCE).greaterThan(expected);
}

function almostEqual(actual: Prisma.Decimal, expected: Prisma.Decimal): boolean {
  return actual.sub(expected).abs().lessThanOrEqualTo(QUANTITY_TOLERANCE);
}

function terminal(status: ExchangeProtectedExitLegStatusResult["status"]): boolean {
  return status === "FILLED" || status === "CANCELED" || status === "REJECTED" || status === "EXPIRED";
}

function active(status: ExchangeProtectedExitLegStatusResult["status"]): boolean {
  return status === "NEW" || status === "PARTIALLY_FILLED" || status === "PENDING_CANCEL";
}

async function markBlocked(orderId: string, reason: string): Promise<LiveOrderRow> {
  const rows = await db.$queryRaw<LiveOrderRow[]>(Prisma.sql`
    UPDATE "TradingLiveOrder"
    SET
      "settlementStatus" = 'BLOCKED',
      "settlementError" = ${reason.slice(0, 500)},
      "status" = CASE
        WHEN "status" IN ('PROTECTED', 'PROTECTION_FAILED') THEN 'PROTECTION_FAILED'
        ELSE "status"
      END,
      "protectionStatus" = CASE
        WHEN "status" IN ('PROTECTED', 'PROTECTION_FAILED') THEN 'FAILED'
        ELSE "protectionStatus"
      END,
      "protectionUpdatedAt" = CASE
        WHEN "status" IN ('PROTECTED', 'PROTECTION_FAILED') THEN CURRENT_TIMESTAMP
        ELSE "protectionUpdatedAt"
      END,
      "version" = "version" + 1
    WHERE "id" = ${orderId}
    RETURNING *
  `);

  if (!rows[0]) throw new Error("LIVE_EXIT_SETTLEMENT_BLOCK_UPDATE_FAILED");
  return rows[0];
}

function sumTradeFills(fills: readonly TradeFill[]): { qty: Prisma.Decimal; quoteQty: Prisma.Decimal } {
  return fills.reduce(
    (total, fill) => ({
      qty: total.qty.add(decimal(fill.qty, "INVALID_TRADE_FILL_QTY")),
      quoteQty: total.quoteQty.add(decimal(fill.quoteQty, "INVALID_TRADE_FILL_QUOTE_QTY")),
    }),
    { qty: new Prisma.Decimal(0), quoteQty: new Prisma.Decimal(0) },
  );
}

function assertTradeFillConsistency(
  fills: TradeFillResult,
  order: LiveOrderRow,
  expectedQty: Prisma.Decimal,
  expectedQuoteQty: Prisma.Decimal,
  expectedBuyer: boolean,
  codePrefix: string,
): void {
  if (fills.symbol.trim().toUpperCase() !== order.symbol.trim().toUpperCase()) {
    throw new Error(`${codePrefix}_SYMBOL_MISMATCH`);
  }
  if (!fills.baseAsset.trim() || !fills.quoteAsset.trim()) {
    throw new Error(`${codePrefix}_ASSET_INFO_REQUIRED`);
  }
  if (fills.fills.length === 0) throw new Error(`${codePrefix}_FILLS_REQUIRED`);
  if (fills.fills.some((fill) => fill.isBuyer !== expectedBuyer)) {
    throw new Error(`${codePrefix}_SIDE_MISMATCH`);
  }

  const totals = sumTradeFills(fills.fills);
  if (!almostEqual(totals.qty, expectedQty)) throw new Error(`${codePrefix}_QTY_MISMATCH`);
  if (!almostEqual(totals.quoteQty, expectedQuoteQty)) throw new Error(`${codePrefix}_QUOTE_QTY_MISMATCH`);
}

async function reconcileTradeFees(input: {
  order: LiveOrderRow;
  entryProviderOrderId: string;
  exitProviderOrderId: string;
  entryQty: Prisma.Decimal;
  entryQuote: Prisma.Decimal;
  exitQty: Prisma.Decimal;
  exitQuote: Prisma.Decimal;
  adapter: TradeFillAdapter;
}): Promise<Prisma.Decimal> {
  if (!input.adapter.getOrderTradeFills) throw new Error("LIVE_TRADE_FILL_ADAPTER_REQUIRED");

  const [entryFills, exitFills] = await Promise.all([
    input.adapter.getOrderTradeFills({ symbol: input.order.symbol, providerOrderId: input.entryProviderOrderId }),
    input.adapter.getOrderTradeFills({ symbol: input.order.symbol, providerOrderId: input.exitProviderOrderId }),
  ]);

  assertTradeFillConsistency(entryFills, input.order, input.entryQty, input.entryQuote, true, "ENTRY_TRADE_FILL");
  assertTradeFillConsistency(exitFills, input.order, input.exitQty, input.exitQuote, false, "EXIT_TRADE_FILL");

  if (
    entryFills.baseAsset.trim().toUpperCase() !== exitFills.baseAsset.trim().toUpperCase() ||
    entryFills.quoteAsset.trim().toUpperCase() !== exitFills.quoteAsset.trim().toUpperCase()
  ) {
    throw new Error("TRADE_FILL_ASSET_MISMATCH");
  }

  const feeResult = reconcileLiveSpotFees({
    baseAsset: entryFills.baseAsset,
    quoteAsset: entryFills.quoteAsset,
    entryExecutedQty: input.entryQty.toString(),
    entryQuoteQty: input.entryQuote.toString(),
    entryFees: entryFills.fills.map((fill) => ({ commission: fill.commission, commissionAsset: fill.commissionAsset })),
    exitExecutedQty: input.exitQty.toString(),
    exitQuoteQty: input.exitQuote.toString(),
    exitFees: exitFills.fills.map((fill) => ({ commission: fill.commission, commissionAsset: fill.commissionAsset })),
  });

  return feeResult.netRealizedPnlUsd;
}

export async function reconcileProtectedExitSettlement(input: {
  order: LiveOrderRow;
  adapter: ExchangeAdapter;
}): Promise<LiveExitSettlementResult> {
  const { order, adapter } = input;

  if (order.status === "CLOSED") {
    return {
      order,
      status: "EXCHANGE_CLOSED_PENDING_WALLET",
      exitPrice: null,
      realizedPnlUsd: null,
      blockers: [],
    };
  }

  if (order.status !== "PROTECTED" || order.protectionStatus !== "PROTECTED") {
    return {
      order,
      status: "NOT_SETTLED",
      exitPrice: null,
      realizedPnlUsd: null,
      blockers: [],
    };
  }

  if (!order.protectionOrderId || !order.stopLossOrderId || !order.takeProfitOrderId) {
    const blocked = await markBlocked(order.id, "PROTECTED_EXIT_IDENTIFIERS_INCOMPLETE");
    return {
      order: blocked,
      status: "BLOCKED",
      exitPrice: null,
      realizedPnlUsd: null,
      blockers: ["PROTECTED_EXIT_IDENTIFIERS_INCOMPLETE"],
    };
  }

  if (!adapter.getProtectedExitLegStatus) {
    const blocked = await markBlocked(order.id, "PROTECTED_EXIT_STATUS_ADAPTER_REQUIRED");
    return {
      order: blocked,
      status: "BLOCKED",
      exitPrice: null,
      realizedPnlUsd: null,
      blockers: ["PROTECTED_EXIT_STATUS_ADAPTER_REQUIRED"],
    };
  }

  let legs: ExchangeProtectedExitLegStatusResult[];
  try {
    legs = await Promise.all([
      adapter.getProtectedExitLegStatus({ symbol: order.symbol, clientOrderId: order.stopLossOrderId }),
      adapter.getProtectedExitLegStatus({ symbol: order.symbol, clientOrderId: order.takeProfitOrderId }),
    ]);
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 300) : "PROTECTED_EXIT_STATUS_UNKNOWN";
    const blocked = await markBlocked(order.id, `PROTECTED_EXIT_STATUS_UNKNOWN:${reason}`);
    return {
      order: blocked,
      status: "BLOCKED",
      exitPrice: null,
      realizedPnlUsd: null,
      blockers: ["PROTECTED_EXIT_STATUS_UNKNOWN"],
    };
  }

  const blockers: string[] = [];
  const expectedLegIds = new Set([order.stopLossOrderId, order.takeProfitOrderId]);
  const seenLegIds = new Set<string>();

  for (const leg of legs) {
    if (leg.symbol.trim().toUpperCase() !== order.symbol.trim().toUpperCase()) blockers.push("EXIT_SYMBOL_MISMATCH");
    if (leg.side !== "SELL") blockers.push("EXIT_SIDE_MISMATCH");
    if (!expectedLegIds.has(leg.clientOrderId)) blockers.push("EXIT_CLIENT_ORDER_ID_MISMATCH");
    if (seenLegIds.has(leg.clientOrderId)) blockers.push("EXIT_DUPLICATE_LEG");
    seenLegIds.add(leg.clientOrderId);
    if (leg.orderListId !== order.protectionOrderId) blockers.push("EXIT_OCO_ID_MISMATCH");
    if (leg.status === "UNKNOWN") blockers.push("EXIT_STATUS_UNKNOWN");
  }

  if (legs.length !== 2 || seenLegIds.size !== 2) blockers.push("EXIT_LEG_COUNT_MISMATCH");

  if (blockers.length > 0) {
    const blocked = await markBlocked(order.id, [...new Set(blockers)].join(","));
    return {
      order: blocked,
      status: "BLOCKED",
      exitPrice: null,
      realizedPnlUsd: null,
      blockers: [...new Set(blockers)],
    };
  }

  const entryQty = decimal(order.executedQty ?? 0, "LIVE_ENTRY_QUANTITY_REQUIRED");
  const entryQuote = decimal(order.cumulativeQuoteQty ?? 0, "LIVE_ENTRY_QUOTE_REQUIRED");
  if (entryQty.lessThanOrEqualTo(0) || entryQuote.lessThanOrEqualTo(0)) {
    const blocked = await markBlocked(order.id, "LIVE_ENTRY_SETTLEMENT_DATA_INCOMPLETE");
    return {
      order: blocked,
      status: "BLOCKED",
      exitPrice: null,
      realizedPnlUsd: null,
      blockers: ["LIVE_ENTRY_SETTLEMENT_DATA_INCOMPLETE"],
    };
  }

  const exitQty = legs.reduce(
    (total, leg) => total.add(decimal(leg.executedQty, "INVALID_EXIT_EXECUTED_QTY")),
    new Prisma.Decimal(0),
  );
  const filledLegs = legs.filter((leg) => leg.status === "FILLED");
  const activeLegs = legs.filter((leg) => active(leg.status));
  const terminalLegs = legs.filter((leg) => terminal(leg.status));

  if (filledLegs.length > 1) {
    const blocked = await markBlocked(order.id, "OCO_BOTH_LEGS_FILLED");
    return {
      order: blocked,
      status: "BLOCKED",
      exitPrice: null,
      realizedPnlUsd: null,
      blockers: ["OCO_BOTH_LEGS_FILLED"],
    };
  }

  if (almostGreater(exitQty, entryQty)) {
    const blocked = await markBlocked(order.id, "EXIT_QUANTITY_EXCEEDS_ENTRY");
    return {
      order: blocked,
      status: "BLOCKED",
      exitPrice: null,
      realizedPnlUsd: null,
      blockers: ["EXIT_QUANTITY_EXCEEDS_ENTRY"],
    };
  }

  if (filledLegs.length === 1 && activeLegs.length === 0 && terminalLegs.length === 2 && almostAtLeast(exitQty, entryQty)) {
    const filled = filledLegs[0];
    const otherLegs = legs.filter((leg) => leg.clientOrderId !== filled.clientOrderId);
    if (!otherLegs.every((leg) => leg.status === "CANCELED" || leg.status === "EXPIRED")) {
      const blocked = await markBlocked(order.id, "OCO_OTHER_LEG_NOT_CANCELED");
      return {
        order: blocked,
        status: "BLOCKED",
        exitPrice: null,
        realizedPnlUsd: null,
        blockers: ["OCO_OTHER_LEG_NOT_CANCELED"],
      };
    }

    const exitQuote = decimal(filled.cumulativeQuoteQty, "INVALID_EXIT_QUOTE");
    if (exitQuote.lessThanOrEqualTo(0)) {
      const blocked = await markBlocked(order.id, "EXIT_QUOTE_REQUIRED_FOR_SETTLEMENT");
      return {
        order: blocked,
        status: "BLOCKED",
        exitPrice: null,
        realizedPnlUsd: null,
        blockers: ["EXIT_QUOTE_REQUIRED_FOR_SETTLEMENT"],
      };
    }

    if (!filled.providerOrderId) {
      const blocked = await markBlocked(order.id, "EXIT_PROVIDER_ORDER_ID_REQUIRED");
      return {
        order: blocked,
        status: "BLOCKED",
        exitPrice: null,
        realizedPnlUsd: null,
        blockers: ["EXIT_PROVIDER_ORDER_ID_REQUIRED"],
      };
    }

    let realizedPnlUsd: Prisma.Decimal;
    try {
      const tradeFillAdapter = adapter as TradeFillAdapter;
      if (!order.providerOrderId) throw new Error("ENTRY_PROVIDER_ORDER_ID_REQUIRED");
      realizedPnlUsd = await reconcileTradeFees({
        order,
        entryProviderOrderId: order.providerOrderId,
        exitProviderOrderId: filled.providerOrderId,
        entryQty,
        entryQuote,
        exitQty,
        exitQuote,
        adapter: tradeFillAdapter,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 300) : "LIVE_TRADE_FEE_RECONCILIATION_FAILED";
      const blocked = await markBlocked(order.id, `LIVE_TRADE_FEE_RECONCILIATION_FAILED:${reason}`);
      return {
        order: blocked,
        status: "BLOCKED",
        exitPrice: null,
        realizedPnlUsd: null,
        blockers: ["LIVE_TRADE_FEE_RECONCILIATION_FAILED"],
      };
    }

    const exitPrice = exitQuote.div(exitQty);

    const rows = await db.$queryRaw<LiveOrderRow[]>(Prisma.sql`
      UPDATE "TradingLiveOrder"
      SET
        "status" = 'CLOSED',
        "settlementStatus" = 'EXCHANGE_CLOSED_PENDING_WALLET',
        "exitProviderOrderId" = ${filled.providerOrderId},
        "exitClientOrderId" = ${filled.clientOrderId},
        "exitPrice" = ${exitPrice.toString()}::numeric,
        "exitExecutedQty" = ${exitQty.toString()}::numeric,
        "exitCumulativeQuoteQty" = ${exitQuote.toString()}::numeric,
        "realizedPnlUsd" = ${realizedPnlUsd.toString()}::numeric,
        "exchangeClosedAt" = CURRENT_TIMESTAMP,
        "settlementError" = NULL,
        "lastError" = NULL,
        "version" = "version" + 1
      WHERE "id" = ${order.id}
        AND "status" = 'PROTECTED'
        AND "protectionStatus" = 'PROTECTED'
      RETURNING *
    `);

    if (!rows[0]) throw new Error("LIVE_EXIT_SETTLEMENT_STATE_CONFLICT");

    return {
      order: rows[0],
      status: "EXCHANGE_CLOSED_PENDING_WALLET",
      exitPrice: exitPrice.toString(),
      realizedPnlUsd: realizedPnlUsd.toString(),
      blockers: [],
    };
  }

  if (activeLegs.length > 0) {
    return {
      order,
      status: "EXCHANGE_OPEN",
      exitPrice: null,
      realizedPnlUsd: null,
      blockers: [],
    };
  }

  if (terminalLegs.length === 2 && exitQty.lessThan(entryQty)) {
    const blocked = await markBlocked(order.id, "OCO_CLOSED_WITH_UNSETTLED_POSITION");
    return {
      order: blocked,
      status: "BLOCKED",
      exitPrice: null,
      realizedPnlUsd: null,
      blockers: ["OCO_CLOSED_WITH_UNSETTLED_POSITION"],
    };
  }

  const blocked = await markBlocked(order.id, "PROTECTED_EXIT_STATE_UNRESOLVED");
  return {
    order: blocked,
    status: "BLOCKED",
    exitPrice: null,
    realizedPnlUsd: null,
    blockers: ["PROTECTED_EXIT_STATE_UNRESOLVED"],
  };
}
