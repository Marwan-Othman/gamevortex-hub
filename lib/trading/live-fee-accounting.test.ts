import { describe, expect, it } from "vitest";
import {
  calculateLiveSpotNetExitProceeds,
  reconcileLiveSpotFees,
} from "@/lib/trading/live-fee-accounting";

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
      entryBaseAssetFeeQuoteValues: ["0.1"],
      exitBaseAssetFeeQuoteValues: ["0.11"],
    });

    expect(result.entryBaseCommission.toString()).toBe("0.00001");
    expect(result.exitBaseCommission.toString()).toBe("0.00001");
    expect(result.netEntryQuoteCost.toString()).toBe("100.1");
    expect(result.netExitQuoteProceeds.toString()).toBe("109.78");
    expect(result.netRealizedPnlUsd.toString()).toBe("9.68");
  });

  it("requires exact per-fill quote values for base-asset commissions in entry and exit reconciliation", () => {
    expect(() => reconcileLiveSpotFees({
      baseAsset: "BTC",
      quoteAsset: "USDT",
      entryExecutedQty: "0.01",
      entryQuoteQty: "100",
      entryFees: [{ commission: "0.00001", commissionAsset: "BTC" }],
      exitExecutedQty: "0.00999",
      exitQuoteQty: "109.89",
      exitFees: [],
    })).toThrow("BASE_ASSET_FEE_QUOTE_CONVERSION_REQUIRED");
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
        entryBaseAssetFeeQuoteValues: ["2"],
        exitExecutedQty: "0.01",
        exitQuoteQty: "110",
        exitFees: [],
      }),
    ).toThrow("EXIT_QTY_EXCEEDS_NET_ENTRY_QTY");
  });
});

describe("calculateLiveSpotNetExitProceeds", () => {
  it("returns quote proceeds after quote-asset fees", () => {
    const result = calculateLiveSpotNetExitProceeds({
      baseAsset: "BTC",
      quoteAsset: "USDT",
      exitExecutedQty: "0.01",
      exitQuoteQty: "110",
      exitFees: [{ commission: "0.11", commissionAsset: "USDT" }],
    });

    expect(result.netExitQuoteProceeds.toString()).toBe("109.89");
  });

  it("returns quote proceeds after base-asset fees", () => {
    const result = calculateLiveSpotNetExitProceeds({
      baseAsset: "BTC",
      quoteAsset: "USDT",
      exitExecutedQty: "0.01",
      exitQuoteQty: "110",
      exitFees: [{ commission: "0.00001", commissionAsset: "BTC" }],
      baseAssetFeeQuoteValues: ["0.11"],
    });

    expect(result.netExitQuoteProceeds.toString()).toBe("109.89");
  });

  it("values base-asset commissions per individual fill, not the blended order price", () => {
    const result = calculateLiveSpotNetExitProceeds({
      baseAsset: "BTC",
      quoteAsset: "USDT",
      exitExecutedQty: "1",
      exitQuoteQty: "200",
      exitFees: [
        { commission: "0.01", commissionAsset: "BTC" },
        { commission: "0.02", commissionAsset: "BTC" },
      ],
      // Fill prices are 100 and 300; fee quote values are 1 and 6.
      // The blended order price would value the fees at 6, not 7.
      baseAssetFeeQuoteValues: ["1", "6"],
    });

    expect(result.baseAssetFeeQuoteValue.toString()).toBe("7");
    expect(result.netExitQuoteProceeds.toString()).toBe("193");
  });

  it("requires exact per-fill quote values for base-asset exit fees", () => {
    expect(() => calculateLiveSpotNetExitProceeds({
      baseAsset: "BTC",
      quoteAsset: "USDT",
      exitExecutedQty: "1",
      exitQuoteQty: "200",
      exitFees: [{ commission: "0.01", commissionAsset: "BTC" }],
    })).toThrow("BASE_ASSET_FEE_QUOTE_CONVERSION_REQUIRED");
  });

  it("requires exact conversion for third-asset exit fees", () => {
    expect(() =>
      calculateLiveSpotNetExitProceeds({
        baseAsset: "BTC",
        quoteAsset: "USDT",
        exitExecutedQty: "0.01",
        exitQuoteQty: "110",
        exitFees: [{ commission: "0.001", commissionAsset: "BNB" }],
      }),
    ).toThrow("THIRD_ASSET_FEE_CONVERSION_REQUIRED");

    const result = calculateLiveSpotNetExitProceeds({
      baseAsset: "BTC",
      quoteAsset: "USDT",
      exitExecutedQty: "0.01",
      exitQuoteQty: "110",
      exitFees: [{ commission: "0.001", commissionAsset: "BNB" }],
      thirdAssetFeeQuoteValues: ["0.8"],
    });

    expect(result.netExitQuoteProceeds.toString()).toBe("109.2");
  });
});
