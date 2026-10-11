import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { calculateOwnerWalletSettlement, exitExecutionDataMatches } from "./live-wallet-settlement";

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

  it("rounds sub-cent proceeds explicitly and records the exact rounding delta", () => {
    const result = calculateOwnerWalletSettlement(new Prisma.Decimal("100.001"));
    expect(result.returnedUsd.toString()).toBe("100");
    expect(result.roundingUsd.toString()).toBe("0.001");
  });

  it("uses half-up cent rounding and records when the credited amount rounds up", () => {
    const result = calculateOwnerWalletSettlement(new Prisma.Decimal("100.005"));
    expect(result.returnedUsd.toString()).toBe("100.01");
    expect(result.roundingUsd.toString()).toBe("-0.005");
  });

  it("rejects non-finite exchange proceeds", () => {
    for (const value of ["NaN", "Infinity", "-Infinity"]) {
      expect(() => calculateOwnerWalletSettlement(new Prisma.Decimal(value))).toThrow(
        "INVALID_SETTLEMENT_PROCEEDS",
      );
    }
  });

  it("rejects negative exchange proceeds", () => {
    expect(() => calculateOwnerWalletSettlement(new Prisma.Decimal("-1"))).toThrow(
      "INVALID_SETTLEMENT_PROCEEDS",
    );
  });
});

describe("exitExecutionDataMatches", () => {
  const dec = (value: string) => new Prisma.Decimal(value);

  it("accepts an unchanged persisted exit execution snapshot", () => {
    expect(exitExecutionDataMatches(
      { exitExecutedQty: dec("1.25"), exitCumulativeQuoteQty: dec("125.50") },
      { exitExecutedQty: dec("1.25"), exitCumulativeQuoteQty: dec("125.50") },
    )).toBe(true);
  });

  it("accepts only differences within the documented quantity tolerance", () => {
    expect(exitExecutionDataMatches(
      { exitExecutedQty: dec("1.25"), exitCumulativeQuoteQty: dec("125.50") },
      { exitExecutedQty: dec("1.2500000000005"), exitCumulativeQuoteQty: dec("125.5000000000005") },
    )).toBe(true);
    expect(exitExecutionDataMatches(
      { exitExecutedQty: dec("1.25"), exitCumulativeQuoteQty: dec("125.50") },
      { exitExecutedQty: dec("1.250000000002"), exitCumulativeQuoteQty: dec("125.50") },
    )).toBe(false);
  });

  it("rejects changed quote proceeds even when executed quantity is unchanged", () => {
    expect(exitExecutionDataMatches(
      { exitExecutedQty: dec("1.25"), exitCumulativeQuoteQty: dec("125.51") },
      { exitExecutedQty: dec("1.25"), exitCumulativeQuoteQty: dec("125.50") },
    )).toBe(false);
  });

  it("fails closed when either snapshot is missing execution data", () => {
    expect(exitExecutionDataMatches(
      { exitExecutedQty: null, exitCumulativeQuoteQty: dec("125.50") },
      { exitExecutedQty: dec("1.25"), exitCumulativeQuoteQty: dec("125.50") },
    )).toBe(false);
    expect(exitExecutionDataMatches(
      { exitExecutedQty: dec("1.25"), exitCumulativeQuoteQty: dec("125.50") },
      { exitExecutedQty: dec("1.25"), exitCumulativeQuoteQty: null },
    )).toBe(false);
  });
});
