import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { calculateOwnerWalletSettlement } from "./live-wallet-settlement";

describe("calculateOwnerWalletSettlement", () => {
  it("converts exact whole-point proceeds without rounding", () => {
    const result = calculateOwnerWalletSettlement(new Prisma.Decimal("100"));

    expect(result.returnedUsd.toString()).toBe("100");
    expect(result.settledPoints).toBe(3000);
    expect(result.settledUsd.toString()).toBe("100");
    expect(result.roundingUsd.toString()).toBe("0");
  });

  it("floors fractional points and records the exact remainder", () => {
    const result = calculateOwnerWalletSettlement(new Prisma.Decimal("100.01"));

    expect(result.settledPoints).toBe(3000);
    expect(result.settledUsd.toString()).toBe("100");
    expect(result.roundingUsd.toString()).toBe("0.01");
  });

  it("never creates wallet value by rounding up", () => {
    const result = calculateOwnerWalletSettlement(new Prisma.Decimal("0.01"));

    expect(result.settledPoints).toBe(0);
    expect(result.settledUsd.toString()).toBe("0");
    expect(result.roundingUsd.toString()).toBe("0.01");
  });

  it("rejects negative exchange proceeds", () => {
    expect(() => calculateOwnerWalletSettlement(new Prisma.Decimal("-1"))).toThrow(
      "INVALID_SETTLEMENT_PROCEEDS",
    );
  });
});
