import { Prisma } from "@prisma/client";

export type LiveTradeFee = {
  commission: string;
  commissionAsset: string;
};

export type LiveFeeSettlementInput = {
  fills: readonly LiveTradeFee[];
  quoteAsset: string;
  baseAsset: string;
  averageFillPrice: Prisma.Decimal | string | number;
};

export type LiveFeeSettlementResult = {
  feeQuoteUsd: Prisma.Decimal;
  unsupportedAssets: string[];
};

function decimal(value: Prisma.Decimal | string | number, code: string): Prisma.Decimal {
  let parsed: Prisma.Decimal;
  try {
    parsed = value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
  } catch {
    throw new Error(code);
  }
  if (!parsed.isFinite() || parsed.isNegative()) throw new Error(code);
  return parsed;
}

function normalizeAsset(value: string, code: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{1,20}$/.test(normalized)) throw new Error(code);
  return normalized;
}

/**
 * Convert Binance trade commissions into quote-currency value without guessing
 * the value of an unrelated fee asset. Quote-asset fees are already monetary;
 * base-asset fees are valued at the actual order's average fill price.
 *
 * Any third asset (for example BNB when the pair is BTCUSDT) is deliberately
 * reported as unsupported instead of being converted using an unverified price.
 * This is a fail-closed accounting boundary.
 */
export function calculateLiveTradeFeeSettlement(
  input: LiveFeeSettlementInput,
): LiveFeeSettlementResult {
  const quoteAsset = normalizeAsset(input.quoteAsset, "INVALID_FEE_QUOTE_ASSET");
  const baseAsset = normalizeAsset(input.baseAsset, "INVALID_FEE_BASE_ASSET");
  const averageFillPrice = decimal(input.averageFillPrice, "INVALID_FEE_AVERAGE_FILL_PRICE");
  if (averageFillPrice.lessThanOrEqualTo(0)) throw new Error("INVALID_FEE_AVERAGE_FILL_PRICE");

  let feeQuoteUsd = new Prisma.Decimal(0);
  const unsupportedAssets = new Set<string>();

  for (const fill of input.fills) {
    const commission = decimal(fill.commission, "INVALID_TRADE_COMMISSION");
    if (commission.isZero()) continue;

    const commissionAsset = normalizeAsset(fill.commissionAsset, "INVALID_TRADE_COMMISSION_ASSET");
    if (commissionAsset === quoteAsset) {
      feeQuoteUsd = feeQuoteUsd.add(commission);
    } else if (commissionAsset === baseAsset) {
      feeQuoteUsd = feeQuoteUsd.add(commission.mul(averageFillPrice));
    } else {
      unsupportedAssets.add(commissionAsset);
    }
  }

  return {
    feeQuoteUsd,
    unsupportedAssets: [...unsupportedAssets].sort(),
  };
}
