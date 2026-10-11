import { beforeEach, describe, expect, it, vi } from "vitest";

const { tx, dbMock } = vi.hoisted(() => {
  const tx = {
    user: { findUnique: vi.fn() },
    vipSubscription: { findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    vipSubscriptionEvent: { findFirst: vi.fn(), create: vi.fn() },
    notification: { create: vi.fn() },
    aiCreditBalance: { upsert: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    aiCreditLedger: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    $queryRaw: vi.fn(),
  };
  const dbMock = {
    aiCreditLedger: { findUnique: vi.fn() },
    vipSubscription: { findFirst: vi.fn() },
    user: { findUnique: vi.fn() },
    $transaction: vi.fn(async (work: (t: typeof tx) => unknown) => work(tx)),
  };
  return { tx, dbMock };
});

vi.mock("@/lib/prisma", () => ({ db: dbMock }));
vi.mock("@/lib/observability", () => ({ logSystemError: vi.fn() }));

import { consumeAiCredit } from "../lib/ai/credits";
import {
  expireVipSubscription,
  getVipSubscriptionStatus,
  revokeVipGvcInTransaction,
} from "../lib/vip-subscriptions";

const KEY = "request-key-000001";

beforeEach(() => {
  vi.clearAllMocks();
  tx.user.findUnique.mockResolvedValue({ role: "USER" });
  tx.vipSubscription.findFirst.mockResolvedValue({ id: "sub1" });
  tx.aiCreditLedger.findUnique.mockResolvedValue(null);
  tx.aiCreditBalance.upsert.mockResolvedValue({});
  tx.aiCreditBalance.updateMany.mockResolvedValue({ count: 1 });
  tx.aiCreditLedger.create.mockResolvedValue({});
});

describe("consumeAiCredit", () => {
  it("refuses to spend when the VIP subscription is gone, without touching the balance", async () => {
    tx.vipSubscription.findFirst.mockResolvedValue(null);
    await expect(consumeAiCredit("u1", "IMAGE", KEY, 10)).rejects.toThrow("AI_VIP_REQUIRED");
    expect(tx.aiCreditBalance.updateMany).not.toHaveBeenCalled();
    expect(tx.aiCreditLedger.create).not.toHaveBeenCalled();
  });

  it("checks that the subscription is ACTIVE and not past its end date", async () => {
    await consumeAiCredit("u1", "CHAT", KEY, 1);
    const where = tx.vipSubscription.findFirst.mock.calls[0][0].where;
    expect(where.status).toBe("ACTIVE");
    expect(where.userId).toBe("u1");
    expect(where.OR).toEqual([{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }]);
  });

  it("lets the owner through without a subscription row", async () => {
    tx.user.findUnique.mockResolvedValue({ role: "SUPER_ADMIN" });
    tx.vipSubscription.findFirst.mockResolvedValue(null);
    await expect(consumeAiCredit("owner", "CHAT", KEY, 1)).resolves.toMatchObject({ alreadyApplied: false });
  });

  it("takes credits with one conditional update and fails when the balance is short", async () => {
    tx.aiCreditBalance.updateMany.mockResolvedValue({ count: 0 });
    await expect(consumeAiCredit("u1", "VIDEO", KEY, 50)).rejects.toThrow("AI_CREDITS_EXHAUSTED");
    expect(tx.aiCreditBalance.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", gvcBalance: { gte: 50 } },
      data: { gvcBalance: { decrement: 50 } },
    });
    expect(tx.aiCreditLedger.create).not.toHaveBeenCalled();
  });

  it("replaying the same reservation reports alreadyApplied and takes nothing", async () => {
    tx.aiCreditLedger.findUnique
      .mockResolvedValueOnce({ delta: -10, kind: "IMAGE" }) // reservation
      .mockResolvedValueOnce(null); // no refund
    await expect(consumeAiCredit("u1", "IMAGE", KEY, 10)).resolves.toEqual({
      consumed: true,
      alreadyApplied: true,
      amount: 10,
    });
    expect(tx.aiCreditBalance.updateMany).not.toHaveBeenCalled();
  });

  it("does not let a key be reused for a bigger amount (free upgrade)", async () => {
    tx.aiCreditLedger.findUnique.mockResolvedValueOnce({ delta: -1, kind: "CHAT" });
    await expect(consumeAiCredit("u1", "CHAT", KEY, 3)).rejects.toThrow("AI_IDEMPOTENCY_KEY_CONFLICT");
  });

  it("does not let a key be reused after its reservation was refunded (free work)", async () => {
    tx.aiCreditLedger.findUnique
      .mockResolvedValueOnce({ delta: -10, kind: "IMAGE" })
      .mockResolvedValueOnce({ id: "refund" });
    await expect(consumeAiCredit("u1", "IMAGE", KEY, 10)).rejects.toThrow("AI_IDEMPOTENCY_KEY_CONFLICT");
  });

  it("rejects non-positive and fractional amounts", async () => {
    await expect(consumeAiCredit("u1", "CHAT", KEY, 0)).rejects.toThrow("INVALID_CREDIT_REQUEST");
    await expect(consumeAiCredit("u1", "CHAT", KEY, 1.5)).rejects.toThrow("INVALID_CREDIT_REQUEST");
    await expect(consumeAiCredit("u1", "CHAT", KEY, -5)).rejects.toThrow("INVALID_CREDIT_REQUEST");
  });
});

describe("revokeVipGvcInTransaction (refund clawback)", () => {
  const input = { userId: "u1", subscriptionId: "sub1", paymentId: "pay1" };

  it("takes back the whole grant when it is still unspent", async () => {
    tx.aiCreditLedger.findFirst.mockResolvedValue({ idempotencyKey: "vip:activation:sub1:pay1", delta: 500 });
    tx.aiCreditLedger.findUnique.mockResolvedValue(null);
    tx.$queryRaw.mockResolvedValue([{ gvcBalance: 800 }]);
    await expect(revokeVipGvcInTransaction(tx as never, input)).resolves.toBe(500);
    expect(tx.aiCreditBalance.update).toHaveBeenCalledWith({
      where: { userId: "u1" },
      data: { gvcBalance: { decrement: 500 } },
    });
  });

  it("only takes what is left and never pushes the balance below zero", async () => {
    tx.aiCreditLedger.findFirst.mockResolvedValue({ idempotencyKey: "vip:activation:sub1:pay1", delta: 500 });
    tx.aiCreditLedger.findUnique.mockResolvedValue(null);
    tx.$queryRaw.mockResolvedValue([{ gvcBalance: 120 }]);
    await expect(revokeVipGvcInTransaction(tx as never, input)).resolves.toBe(120);
    expect(tx.aiCreditBalance.update).toHaveBeenCalledWith({
      where: { userId: "u1" },
      data: { gvcBalance: { decrement: 120 } },
    });
  });

  it("records the revoke even when nothing was left, and does not touch the balance", async () => {
    tx.aiCreditLedger.findFirst.mockResolvedValue({ idempotencyKey: "vip:activation:sub1:pay1", delta: 500 });
    tx.aiCreditLedger.findUnique.mockResolvedValue(null);
    tx.$queryRaw.mockResolvedValue([{ gvcBalance: 0 }]);
    await expect(revokeVipGvcInTransaction(tx as never, input)).resolves.toBe(0);
    expect(tx.aiCreditBalance.update).not.toHaveBeenCalled();
    expect(tx.aiCreditLedger.create).toHaveBeenCalled();
  });

  it("is idempotent: a repeated refund event takes nothing more", async () => {
    tx.aiCreditLedger.findFirst.mockResolvedValue({ idempotencyKey: "vip:activation:sub1:pay1", delta: 500 });
    tx.aiCreditLedger.findUnique.mockResolvedValue({ delta: -500 });
    await expect(revokeVipGvcInTransaction(tx as never, input)).resolves.toBe(500);
    expect(tx.aiCreditBalance.update).not.toHaveBeenCalled();
    expect(tx.aiCreditLedger.create).not.toHaveBeenCalled();
  });

  it("does nothing when the payment never granted credits", async () => {
    tx.aiCreditLedger.findFirst.mockResolvedValue(null);
    await expect(revokeVipGvcInTransaction(tx as never, input)).resolves.toBe(0);
    await expect(revokeVipGvcInTransaction(tx as never, { ...input, paymentId: null })).resolves.toBe(0);
  });
});

describe("expireVipSubscription", () => {
  const sub = { id: "sub1", userId: "u1", plan: { code: "VIP_1M", nameAr: "VIP شهر" } };

  it("expires through one conditional update and notifies once", async () => {
    tx.vipSubscription.findUnique.mockResolvedValue(sub);
    tx.vipSubscription.updateMany.mockResolvedValue({ count: 1 });
    tx.vipSubscriptionEvent.create.mockResolvedValue({});
    await expect(expireVipSubscription("sub1")).resolves.toMatchObject({ changed: true });
    const where = tx.vipSubscription.updateMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ id: "sub1", status: "ACTIVE", expiresAt: { not: null, lte: expect.any(Date) } });
    expect(tx.notification.create).toHaveBeenCalledTimes(1);
  });

  it("does nothing (no event, no notification) when another worker already expired it", async () => {
    tx.vipSubscription.findUnique.mockResolvedValue(sub);
    tx.vipSubscription.updateMany.mockResolvedValue({ count: 0 });
    await expect(expireVipSubscription("sub1")).resolves.toMatchObject({ changed: false });
    expect(tx.vipSubscriptionEvent.create).not.toHaveBeenCalled();
    expect(tx.notification.create).not.toHaveBeenCalled();
  });
});

describe("getVipSubscriptionStatus", () => {
  const plan = { code: "VIP_1M", pointsMultiplier: 1.25 };

  beforeEach(() => {
    dbMock.user.findUnique.mockResolvedValue({ id: "u1", role: "USER", points: 5 });
  });

  it("reports the active subscription even when a newer pending checkout exists", async () => {
    const active = {
      id: "sub-active",
      status: "ACTIVE",
      plan,
      startedAt: new Date("2026-10-01"),
      expiresAt: new Date(Date.now() + 86_400_000),
    };
    dbMock.vipSubscription.findFirst.mockResolvedValueOnce(active);
    const status = await getVipSubscriptionStatus("u1");
    expect(status).toMatchObject({ isVip: true, status: "ACTIVE", subscriptionId: "sub-active" });
    expect(dbMock.vipSubscription.findFirst).toHaveBeenCalledTimes(1);
  });

  it("reports EXPIRED (not NONE) when the end date passed but the worker has not run yet", async () => {
    const lapsed = {
      id: "sub-old",
      status: "ACTIVE",
      plan,
      startedAt: new Date("2026-01-01"),
      expiresAt: new Date(Date.now() - 1000),
    };
    dbMock.vipSubscription.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(lapsed);
    const status = await getVipSubscriptionStatus("u1");
    expect(status).toMatchObject({ isVip: false, status: "EXPIRED", planCode: "FREE", pointsMultiplier: 1 });
  });

  it("ignores checkouts that were never paid", async () => {
    dbMock.vipSubscription.findFirst.mockResolvedValue(null);
    const status = await getVipSubscriptionStatus("u1");
    expect(status).toMatchObject({ isVip: false, status: "NONE" });
    const fallbackWhere = dbMock.vipSubscription.findFirst.mock.calls[1][0].where;
    expect(fallbackWhere.status.in).not.toContain("PENDING");
    expect(fallbackWhere.status.in).not.toContain("PAYMENT_FAILED");
    expect(fallbackWhere.startedAt).toEqual({ not: null });
  });

  it("owner is permanent VIP without any subscription", async () => {
    dbMock.user.findUnique.mockResolvedValue({ id: "o", role: "SUPER_ADMIN", points: 0 });
    await expect(getVipSubscriptionStatus("o")).resolves.toMatchObject({ isOwner: true, isVip: true, status: "OWNER" });
    expect(dbMock.vipSubscription.findFirst).not.toHaveBeenCalled();
  });
});
