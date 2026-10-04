import { describe, expect, it } from "vitest";
import { reconcileLiveSpotFees } from "@/lib/trading/live-fee-accounting";

describe("reconcileLiveSpotFees", () => {
  it("subtracts quote-asset commissions from entry cost and exit proceeds", () => {
    const result = reconcileLiveSpotFees({
      baseAsset: "BTC",
      quoteAsset: "USDT",
      entryExecutedQty: "0.01",
      entryQuoteQty: "100",
      entryFees: [{ commission: "0.1", commissionAsset: "USDT" }],
      exitExecutedQty: "0.01",
      exitQuoteQty: "110",
      exitFees: [{ commission: "0.11", commissionAsset: "USDT" }],
    });

    expect(result.netEntryQuoteCost.toString()).toBe("100.1");
    expect(result.netExitQuoteProceeds.toString()).toBe("109.89");
    expect(result.netRealizedPnlUsd.toString()).toBe("9.79");
  });

  it("values base-asset commissions at their actual fill prices", () => {
    const result = reconcileLiveSpotFees({
      baseAsset: "BTC",
      quoteAsset: "USDT",
      entryExecutedQty: "0.01",
      entryQuoteQty: "100",
      entryFees: [{ commission: "0.00001", commissionAsset: "BTC" }],
      exitExecutedQty: "0.00999",
      exitQuoteQty: "109.89",
      exitFees: [{ commission: "0.00001", commissionAsset: "BTC" }],
    });

    expect(result.entryBaseCommission.toString()).toBe("0.00001");
    expect(result.exitBaseCommission.toString()).toBe("0.00001");
    expect(result.netEntryQuoteCost.toString()).toBe("100.1");
    expect(result.netExitQuoteProceeds.toString()).toBe("109.78");
    expect(result.netRealizedPnlUsd.toString()).toBe("9.68");
  });

  it("requires an exact quote conversion for a third-asset commission", () => {
    expect(() =>
      reconcileLiveSpotFees({
        baseAsset: "BTC",
        quoteAsset: "USDT",
        entryExecutedQty: "0.01",
        entryQuoteQty: "100",
        entryFees: [{ commission: "0.001", commissionAsset: "BNB" }],
        exitExecutedQty: "0.01",
        exitQuoteQty: "110",
        exitFees: [],
      }),
    ).toThrow("THIRD_ASSET_FEE_CONVERSION_REQUIRED");

    const result = reconcileLiveSpotFees({
      baseAsset: "BTC",
      quoteAsset: "USDT",
      entryExecutedQty: "0.01",
      entryQuoteQty: "100",
      entryFees: [{ commission: "0.001", commissionAsset: "BNB" }],
      exitExecutedQty: "0.01",
      exitQuoteQty: "110",
      exitFees: [],
      thirdAssetFeeQuoteValues: ["0.8"],
    });

    expect(result.netRealizedPnlUsd.toString()).toBe("9.2");
  });

  it("blocks an exit that exceeds the net acquired base quantity", () => {
    expect(() =>
      reconcileLiveSpotFees({
        baseAsset: "BTC",
        quoteAsset: "USDT",
        entryExecutedQty: "0.01",
        entryQuoteQty: "100",
        entryFees: [{ commission: "0.0002", commissionAsset: "BTC" }],
        exitExecutedQty: "0.01",
        exitQuoteQty: "110",
        exitFees: [],
      }),
    ).toThrow("EXIT_QTY_EXCEEDS_NET_ENTRY_QTY");
  });
});
