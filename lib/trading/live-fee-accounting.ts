/**
 * GameVortex AI Trading — deterministic Spot fee accounting.
 *
 * This module converts provider-reported trade commissions into quote-asset
 * accounting only when the conversion is exact. It deliberately refuses to
 * guess the value of a commission paid in a third asset.
 *
 * Binance defines `commission` as the fee paid on a trade and
 * `commissionAsset` as the asset from which the fee was deducted. Therefore
 * a gross quote P/L cannot be treated as final net settlement without the
 * actual fill-level commission records.
 */

import { Prisma } from "@prisma/client";

export type LiveTradeFee = {
  commission: string;
  commissionAsset: string;
};

export type LiveFeeAccountingInput = {
  baseAsset: string;
  quoteAsset: string;
  entryExecutedQty: string;
  entryQuoteQty: string;
  entryFees: readonly LiveTradeFee[];
  exitExecutedQty: string;
  exitQuoteQty: string;
  exitFees: readonly LiveTradeFee[];
  /** Exact quote-asset value for third-asset commissions, when available. */
  thirdAssetFeeQuoteValues?: readonly string[];
};

export type LiveFeeAccountingResult = {
  entryBaseCommission: Prisma.Decimal;
  exitBaseCommission: Prisma.Decimal;
  entryQuoteFees: Prisma.Decimal;
  exitQuoteFees: Prisma.Decimal;
  thirdAssetFeeQuoteValue: Prisma.Decimal;
  netEntryQuoteCost: Prisma.Decimal;
  netExitQuoteProceeds: Prisma.Decimal;
  netRealizedPnlUsd: Prisma.Decimal;
};

function decimal(value: string, code: string): Prisma.Decimal {
  let parsed: Prisma.Decimal;
  try {
    parsed = new Prisma.Decimal(value);
  } catch {
    throw new Error(code);
  }
  if (!parsed.isFinite() || parsed.lessThan(0)) throw new Error(code);
  return parsed;
}

function asset(value: string, code: string): string {
  const normalized = value.trim().toUpperCase();
  if (!normalized || !/^[A-Z0-9._:-]{1,32}$/.test(normalized)) throw new Error(code);
  return normalized;
}

function sumFees(
  fees: readonly LiveTradeFee[],
  baseAsset: string,
  quoteAsset: string,
): { base: Prisma.Decimal; quote: Prisma.Decimal; thirdCount: number } {
  let base = new Prisma.Decimal(0);
  let quote = new Prisma.Decimal(0);
  let thirdCount = 0;

  for (const fee of fees) {
    const amount = decimal(fee.commission, "INVALID_TRADE_COMMISSION");
    const commissionAsset = asset(fee.commissionAsset, "INVALID_TRADE_COMMISSION_ASSET");

    if (commissionAsset === baseAsset) {
      base = base.add(amount);
    } else if (commissionAsset === quoteAsset) {
      quote = quote.add(amount);
    } else {
      thirdCount += 1;
    }
  }

  return { base, quote, thirdCount };
}

export function reconcileLiveSpotFees(input: LiveFeeAccountingInput): LiveFeeAccountingResult {
  const baseAsset = asset(input.baseAsset, "INVALID_BASE_ASSET");
  const quoteAsset = asset(input.quoteAsset, "INVALID_QUOTE_ASSET");
  if (baseAsset === quoteAsset) throw new Error("BASE_AND_QUOTE_ASSET_MUST_DIFFER");

  const entryQty = decimal(input.entryExecutedQty, "INVALID_ENTRY_EXECUTED_QTY");
  const entryQuote = decimal(input.entryQuoteQty, "INVALID_ENTRY_QUOTE_QTY");
  const exitQty = decimal(input.exitExecutedQty, "INVALID_EXIT_EXECUTED_QTY");
  const exitQuote = decimal(input.exitQuoteQty, "INVALID_EXIT_QUOTE_QTY");
  if (entryQty.lessThanOrEqualTo(0) || entryQuote.lessThanOrEqualTo(0)) throw new Error("ENTRY_FILL_REQUIRED");
  if (exitQty.lessThanOrEqualTo(0) || exitQuote.lessThanOrEqualTo(0)) throw new Error("EXIT_FILL_REQUIRED");

  const entry = sumFees(input.entryFees, baseAsset, quoteAsset);
  const exit = sumFees(input.exitFees, baseAsset, quoteAsset);
  const thirdAssetCount = entry.thirdCount + exit.thirdCount;
  const thirdAssetValues = (input.thirdAssetFeeQuoteValues ?? []).map((value) =>
    decimal(value, "INVALID_THIRD_ASSET_FEE_QUOTE_VALUE"),
  );

  if (thirdAssetValues.length !== thirdAssetCount) {
    throw new Error("THIRD_ASSET_FEE_CONVERSION_REQUIRED");
  }

  const thirdAssetFeeQuoteValue = thirdAssetValues.reduce(
    (total, value) => total.add(value),
    new Prisma.Decimal(0),
  );

  const entryNetBaseQty = entryQty.sub(entry.base);
  if (entryNetBaseQty.lessThanOrEqualTo(0)) throw new Error("ENTRY_BASE_QTY_CONSUMED_BY_FEES");

  if (exitQty.greaterThan(entryNetBaseQty)) {
    throw new Error("EXIT_QTY_EXCEEDS_NET_ENTRY_QTY");
  }

  const netEntryQuoteCost = entryQuote.add(entry.quote);
  const netExitQuoteProceeds = exitQuote.sub(exit.quote);
  const netRealizedPnlUsd = netExitQuoteProceeds.sub(netEntryQuoteCost).sub(thirdAssetFeeQuoteValue);

  return {
    entryBaseCommission: entry.base,
    exitBaseCommission: exit.base,
    entryQuoteFees: entry.quote,
    exitQuoteFees: exit.quote,
    thirdAssetFeeQuoteValue,
    netEntryQuoteCost,
    netExitQuoteProceeds,
    netRealizedPnlUsd,
  };
}
