import { beforeEach, describe, expect, it, vi } from "vitest";

const { tx, dbMock } = vi.hoisted(() => { const tx = {
  pointLedger: { findUnique: vi.fn(), create: vi.fn(async ({ data }: { data: unknown }) => data) },
  user: { updateMany: vi.fn(), findUnique: vi.fn() },
};
const dbMock = {
  pointLedger: { findUnique: vi.fn() },
  $transaction: vi.fn(async (work: (t: typeof tx) => unknown) => work(tx)),
};
  return { tx, dbMock };
});

vi.mock("@/lib/prisma", () => ({ db: dbMock }));

import { adjustPoints, creditPoints, debitPoints } from "../lib/points";

const key = "standalone-key-000001";

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.pointLedger.findUnique.mockResolvedValue(null);
  tx.pointLedger.findUnique.mockResolvedValue(null);
  tx.user.updateMany.mockResolvedValue({ count: 1 });
  tx.user.findUnique.mockResolvedValue({ id: "u1", points: 50 });
});

describe("stand-alone point ledger writes", () => {
  it("rejects a reused idempotency key with a different amount", async () => {
    dbMock.pointLedger.findUnique.mockResolvedValue({ userId: "u1", amount: 10, type: "CREDIT", reason: "R" });
    await expect(creditPoints({ userId: "u1", amount: 99, reason: "R", idempotencyKey: key })).rejects.toThrow("IDEMPOTENCY_KEY_CONFLICT");
    expect(tx.user.updateMany).not.toHaveBeenCalled();
  });

  it("replays the same operation without touching the balance", async () => {
    const row = { userId: "u1", amount: 10, type: "CREDIT", reason: "R" };
    dbMock.pointLedger.findUnique.mockResolvedValue(row);
    await expect(creditPoints({ userId: "u1", amount: 10, reason: "R", idempotencyKey: key })).resolves.toBe(row);
    expect(dbMock.$transaction).not.toHaveBeenCalled();
  });

  it("debits with one conditional update and never below zero", async () => {
    tx.user.updateMany.mockResolvedValue({ count: 0 });
    await expect(debitPoints({ userId: "u1", amount: 10, reason: "R", idempotencyKey: key })).rejects.toThrow("INSUFFICIENT_POINTS");
    expect(tx.user.updateMany).toHaveBeenCalledWith({ where: { id: "u1", points: { gte: 10 } }, data: { points: { decrement: 10 } } });
    expect(tx.pointLedger.create).not.toHaveBeenCalled();
  });

  it("negative adjustments are guarded too", async () => {
    tx.user.updateMany.mockResolvedValue({ count: 0 });
    await expect(adjustPoints({ userId: "u1", amount: -5, reason: "R", idempotencyKey: key })).rejects.toThrow("ADJUSTMENT_WOULD_MAKE_POINTS_NEGATIVE");
  });

  it("writes the ledger row with the balance after the change", async () => {
    await creditPoints({ userId: "u1", amount: 10, reason: "R", idempotencyKey: key });
    expect(tx.pointLedger.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: "CREDIT", amount: 10, balanceAfter: 50 }) });
  });

  it("retries a serialization failure and then succeeds", async () => {
    dbMock.$transaction.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "P2034" }));
    await expect(creditPoints({ userId: "u1", amount: 10, reason: "R", idempotencyKey: key })).resolves.toBeTruthy();
    expect(dbMock.$transaction).toHaveBeenCalledTimes(2);
  });
});
