import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { calculateStorePurchasePoints, calculateProductRewardPoints, creditPointsInTransaction, debitPointsInTransaction, pointsToValueCents, reversePointsInTransaction, USER_POINTS_PER_USD, VIP_POINTS_PER_USD } from "../lib/points";

function transaction(overrides: Record<string, unknown> = {}) {
  const value = {
    pointLedger: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn(async ({ data }: { data: unknown }) => data) },
    user: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), update: vi.fn().mockResolvedValue({}), findUnique: vi.fn().mockResolvedValue({ points: 90 }) },
    ...overrides,
  };
  return value as unknown as Prisma.TransactionClient & typeof value;
}

describe("point conversion policy", () => {
  it("uses the published regular and VIP point values", () => { expect(pointsToValueCents(USER_POINTS_PER_USD)).toBe(100); expect(pointsToValueCents(VIP_POINTS_PER_USD, true)).toBe(100); expect(pointsToValueCents(499, true)).toBe(99); });
  it("awards points only against confirmed USD purchases", () => { expect(calculateStorePurchasePoints(10_000, "USD")).toBe(1_000); expect(calculateStorePurchasePoints(250, "USD")).toBe(25); expect(calculateStorePurchasePoints(10_000, "EUR")).toBe(0); expect(() => calculateStorePurchasePoints(-1, "USD")).toThrow("INVALID_PURCHASE_AMOUNT"); });
  it("calculates per-product rewards, using the purchase rate only when no override is configured", () => { expect(calculateProductRewardPoints([{ quantity: 2, unitPriceCents: 500, currency: "USD", rewardPoints: 40 }, { quantity: 1, unitPriceCents: 1_000, currency: "USD", rewardPoints: null }, { quantity: 3, unitPriceCents: 500, currency: "USD", rewardPoints: 0 }])).toBe(180); expect(calculateProductRewardPoints([{ quantity: 2, unitPriceCents: 500, currency: "EUR", rewardPoints: null }])).toBe(0); expect(() => calculateProductRewardPoints([{ quantity: 1, unitPriceCents: 100, currency: "USD", rewardPoints: -1 }])).toThrow("INVALID_PRODUCT_REWARD_POINTS"); });
});

describe("transaction point ledger", () => {
  it("credits points and writes the resulting balance", async () => { const tx = transaction(); const ledger = await creditPointsInTransaction(tx, { userId: "user-1", amount: 10, reason: "TEST_CREDIT", idempotencyKey: "credit-key-0000001" }); expect(tx.user.updateMany).toHaveBeenCalledOnce(); expect(tx.pointLedger.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: "CREDIT", amount: 10, balanceAfter: 90 }) })); expect(ledger).toMatchObject({ type: "CREDIT", amount: 10 }); });
  it("does not debit when the balance is insufficient", async () => { const tx = transaction({ user: { updateMany: vi.fn().mockResolvedValue({ count: 0 }), findUnique: vi.fn() } }); await expect(debitPointsInTransaction(tx, { userId: "user-1", amount: 10, reason: "TEST_DEBIT", idempotencyKey: "debit-key-0000001" })).rejects.toThrow("INSUFFICIENT_POINTS"); expect(tx.pointLedger.create).not.toHaveBeenCalled(); });
  it("reverses spent points transparently as a negative balance", async () => { const tx = transaction({ user: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), update: vi.fn(), findUnique: vi.fn().mockResolvedValue({ points: -5 }) } }); const ledger = await reversePointsInTransaction(tx, { userId: "user-1", amount: 5, reason: "PURCHASE_REFUND", idempotencyKey: "refund-key-0000001" }); expect(ledger).toMatchObject({ type: "REVERSAL", amount: -5, balanceAfter: -5 }); });
});
