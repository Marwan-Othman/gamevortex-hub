import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { calculateLiveTradeFeeSettlement } from "@/lib/trading/live-fee-settlement";

describe("live trade fee settlement", () => {
  it("uses quote-asset commissions directly", () => {
    const result = calculateLiveTradeFeeSettlement({
      fills: [
        { commission: "0.02", commissionAsset: "USDT" },
        { commission: "0.01", commissionAsset: "USDT" },
      ],
      quoteAsset: "USDT",
      baseAsset: "BTC",
      averageFillPrice: "50000",
    });

    expect(result.feeQuoteUsd.eq(new Prisma.Decimal("0.03"))).toBe(true);
    expect(result.unsupportedAssets).toEqual([]);
  });

  it("values base-asset commissions at the order's actual average fill price", () => {
    const result = calculateLiveTradeFeeSettlement({
      fills: [{ commission: "0.000001", commissionAsset: "BTC" }],
      quoteAsset: "USDT",
      baseAsset: "BTC",
      averageFillPrice: "50000",
    });

    expect(result.feeQuoteUsd.eq(new Prisma.Decimal("0.05"))).toBe(true);
    expect(result.unsupportedAssets).toEqual([]);
  });

  it("does not guess the value of a third-asset commission", () => {
    const result = calculateLiveTradeFeeSettlement({
      fills: [{ commission: "0.001", commissionAsset: "BNB" }],
      quoteAsset: "USDT",
      baseAsset: "BTC",
      averageFillPrice: "50000",
    });

    expect(result.feeQuoteUsd.isZero()).toBe(true);
    expect(result.unsupportedAssets).toEqual(["BNB"]);
  });

  it("combines supported fees and reports unsupported assets deterministically", () => {
    const result = calculateLiveTradeFeeSettlement({
      fills: [
        { commission: "0.01", commissionAsset: "USDT" },
        { commission: "0.000001", commissionAsset: "BTC" },
        { commission: "0.001", commissionAsset: "BNB" },
        { commission: "0", commissionAsset: "BNB" },
      ],
      quoteAsset: "USDT",
      baseAsset: "BTC",
      averageFillPrice: "50000",
    });

    expect(result.feeQuoteUsd.eq(new Prisma.Decimal("0.06"))).toBe(true);
    expect(result.unsupportedAssets).toEqual(["BNB"]);
  });

  it("rejects malformed or negative commission data", () => {
    expect(() =>
      calculateLiveTradeFeeSettlement({
        fills: [{ commission: "-0.01", commissionAsset: "USDT" }],
        quoteAsset: "USDT",
        baseAsset: "BTC",
        averageFillPrice: "50000",
      }),
    ).toThrow("INVALID_TRADE_COMMISSION");
  });
});
