import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { calculateOwnerWalletSettlement } from "./live-wallet-settlement";

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
