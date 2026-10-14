import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { calculateOwnerWalletSettlement, getSettlementCurrencyBlocker } from "./live-wallet-settlement";

describe("calculateOwnerWalletSettlement", () => {
  it("returns exact USD proceeds without point conversion or rounding", () => {
    const result = calculateOwnerWalletSettlement(new Prisma.Decimal("100"));
    expect(result.returnedUsd.toString()).toBe("100");
  });

  it("preserves fractional USD proceeds exactly", () => {
    const result = calculateOwnerWalletSettlement(new Prisma.Decimal("100.01"));
    expect(result.returnedUsd.toString()).toBe("100.01");
  });

  it("preserves small USD proceeds without creating or destroying value", () => {
    const result = calculateOwnerWalletSettlement(new Prisma.Decimal("0.01"));
    expect(result.returnedUsd.toString()).toBe("0.01");
  });

  it("rejects negative exchange proceeds", () => {
    expect(() => calculateOwnerWalletSettlement(new Prisma.Decimal("-1"))).toThrow(
      "INVALID_SETTLEMENT_PROCEEDS",
    );
  });
});

describe("getSettlementCurrencyBlocker", () => {
  it("allows only explicit USD quote proceeds", () => {
    expect(getSettlementCurrencyBlocker("USD")).toBeNull();
    expect(getSettlementCurrencyBlocker(" usd ")).toBeNull();
  });

  it("blocks USDT and USDC until verified USD conversion exists", () => {
    expect(getSettlementCurrencyBlocker("USDT")).toBe("SETTLEMENT_QUOTE_CURRENCY_REQUIRES_VERIFIED_USD_CONVERSION");
    expect(getSettlementCurrencyBlocker("USDC")).toBe("SETTLEMENT_QUOTE_CURRENCY_REQUIRES_VERIFIED_USD_CONVERSION");
  });

  it("rejects a missing quote asset", () => {
    expect(() => getSettlementCurrencyBlocker(" ")).toThrow("SETTLEMENT_EXIT_ASSET_INFO_REQUIRED");
  });
});
