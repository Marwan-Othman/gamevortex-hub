import { describe, expect, it } from "vitest";
import { computeSellableQuantity } from "./live-sellable-quantity";

describe("computeSellableQuantity", () => {
  it("subtracts a base-asset entry commission", () => {
    expect(
      computeSellableQuantity({
        executedQty: "10",
        baseAsset: "SOL",
        fees: [{ commission: "0.01", commissionAsset: "SOL" }],
      }),
    ).toBe("9.99");
  });

  it("does not subtract quote-asset or third-asset commissions", () => {
    expect(
      computeSellableQuantity({
        executedQty: "10",
        baseAsset: "SOL",
        fees: [
          { commission: "0.5", commissionAsset: "USDT" },
          { commission: "0.002", commissionAsset: "BNB" },
        ],
      }),
    ).toBe("10");
  });

  it("matches asset names case-insensitively and sums several fills", () => {
    expect(
      computeSellableQuantity({
        executedQty: "1",
        baseAsset: "btc",
        fees: [
          { commission: "0.0005", commissionAsset: "BTC" },
          { commission: "0.0005", commissionAsset: "btc" },
        ],
      }),
    ).toBe("0.999");
  });

  it("floors to the step size and never rounds up", () => {
    expect(
      computeSellableQuantity({
        executedQty: "1.2349",
        baseAsset: "ETH",
        fees: [],
        stepSize: "0.001",
      }),
    ).toBe("1.234");
  });

  it("combines commission netting and step flooring", () => {
    expect(
      computeSellableQuantity({
        executedQty: "0.0100",
        baseAsset: "BTC",
        fees: [{ commission: "0.00001", commissionAsset: "BTC" }],
        stepSize: "0.00001",
      }),
    ).toBe("0.00999");
  });

  it("throws when fees consume the whole quantity", () => {
    expect(() =>
      computeSellableQuantity({
        executedQty: "1",
        baseAsset: "SOL",
        fees: [{ commission: "1", commissionAsset: "SOL" }],
      }),
    ).toThrow("LIVE_SELLABLE_QUANTITY_NOT_POSITIVE");
  });

  it("throws when flooring leaves nothing sellable (dust)", () => {
    expect(() =>
      computeSellableQuantity({ executedQty: "0.0004", baseAsset: "BTC", fees: [], stepSize: "0.001" }),
    ).toThrow("LIVE_SELLABLE_QUANTITY_NOT_POSITIVE");
  });

  it("rejects exponent notation and garbage instead of guessing", () => {
    for (const executedQty of ["1e-7", "-1", "abc", ""]) {
      expect(() => computeSellableQuantity({ executedQty, baseAsset: "BTC", fees: [] })).toThrow(
        "INVALID_EXECUTED_QTY",
      );
    }
  });
});
