import { beforeEach, describe, expect, it, vi } from "vitest";

const { tx, dbMock } = vi.hoisted(() => {
  const tx = {
    vipSubscription: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    vipSubscriptionEvent: { findFirst: vi.fn(), create: vi.fn() },
    vipPurchase: { update: vi.fn(), updateMany: vi.fn() },
    notification: { findFirst: vi.fn(), create: vi.fn() },
    aiCreditBalance: { upsert: vi.fn() },
    aiCreditLedger: { findUnique: vi.fn(), create: vi.fn() },
  };
  const dbMock = {
    $transaction: vi.fn(async (work: (t: typeof tx) => unknown) => work(tx)),
  };
  return { tx, dbMock };
});

vi.mock("@/lib/prisma", () => ({ db: dbMock }));

import { activateVipSubscription, renewVipSubscription } from "../lib/vip-subscriptions";

const DAY = 86_400_000;

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub-new",
    userId: "u1",
    status: "PENDING",
    paymentId: null,
    plan: { code: "VIP_1M", nameAr: "VIP شهر", nameEn: "VIP 1 Month", priceCents: 499, currency: "USD", durationMonths: 1, gvcGrant: 500 },
    user: { id: "u1", role: "USER" },
    purchase: { id: "pur1", amountCents: 499, currency: "USD" },
    ...overrides,
  };
}

const base = { subscriptionId: "sub-new", provider: "stripe", paymentId: "pay_1", amountCents: 499, currency: "USD" };

beforeEach(() => {
  vi.clearAllMocks();
  tx.vipSubscription.update.mockImplementation(async ({ data }: { data: object }) => ({ ...subscription(), ...data }));
  tx.vipSubscription.updateMany.mockResolvedValue({ count: 1 });
  tx.vipSubscriptionEvent.findFirst.mockResolvedValue(null);
  tx.vipSubscriptionEvent.create.mockResolvedValue({});
  tx.vipPurchase.update.mockResolvedValue({});
  tx.vipPurchase.updateMany.mockResolvedValue({ count: 1 });
  tx.notification.findFirst.mockResolvedValue(null);
  tx.notification.create.mockResolvedValue({});
  tx.aiCreditLedger.findUnique.mockResolvedValue(null);
  tx.aiCreditLedger.create.mockResolvedValue({});
  tx.aiCreditBalance.upsert.mockResolvedValue({});
});

describe("activateVipSubscription", () => {
  it("accepts the amount that was charged even if the catalog price changed afterwards", async () => {
    // Checkout was created at $4.99; an admin has since moved the plan to $9.99.
    tx.vipSubscription.findUnique.mockResolvedValue(
      subscription({ plan: { ...subscription().plan, priceCents: 999 } }),
    );
    await expect(activateVipSubscription(base)).resolves.toMatchObject({ reused: false });
    expect(tx.aiCreditBalance.upsert).toHaveBeenCalled();
  });

  it("rejects a payment that does not match what the checkout was created for", async () => {
    tx.vipSubscription.findUnique.mockResolvedValue(subscription());
    await expect(activateVipSubscription({ ...base, amountCents: 1 })).rejects.toThrow("VIP_PAYMENT_AMOUNT_MISMATCH");
    await expect(activateVipSubscription({ ...base, currency: "EUR" })).rejects.toThrow("VIP_PAYMENT_CURRENCY_MISMATCH");
    expect(tx.vipSubscription.update).not.toHaveBeenCalled();
    expect(tx.aiCreditBalance.upsert).not.toHaveBeenCalled();
  });

  it("never brings a refunded or canceled subscription back", async () => {
    for (const status of ["REFUNDED", "CANCELED"]) {
      tx.vipSubscription.findUnique.mockResolvedValue(subscription({ status }));
      await expect(activateVipSubscription(base)).rejects.toThrow("VIP_SUBSCRIPTION_NOT_ACTIVATABLE");
    }
    expect(tx.vipSubscription.update).not.toHaveBeenCalled();
  });

  it("a second delivery of the same payment grants nothing again", async () => {
    tx.vipSubscription.findUnique.mockResolvedValue(subscription({ status: "ACTIVE", paymentId: "pay_1" }));
    await expect(activateVipSubscription(base)).resolves.toMatchObject({ reused: true });
    expect(tx.aiCreditBalance.upsert).not.toHaveBeenCalled();
  });

  it("a different payment cannot activate an already active subscription", async () => {
    tx.vipSubscription.findUnique.mockResolvedValue(subscription({ status: "ACTIVE", paymentId: "pay_0" }));
    await expect(activateVipSubscription(base)).rejects.toThrow("VIP_SUBSCRIPTION_ALREADY_ACTIVE");
  });

  it("the owner never goes through payment", async () => {
    tx.vipSubscription.findUnique.mockResolvedValue(subscription({ user: { id: "o", role: "SUPER_ADMIN" } }));
    await expect(activateVipSubscription(base)).rejects.toThrow("OWNER_VIP_DOES_NOT_USE_PAYMENT");
  });

  it("starts the term now and ends it after the plan duration", async () => {
    tx.vipSubscription.findUnique.mockResolvedValue(subscription());
    const before = Date.now();
    await activateVipSubscription(base);
    const data = tx.vipSubscription.update.mock.calls[0][0].data;
    expect(data.status).toBe("ACTIVE");
    expect(data.startedAt.getTime()).toBeGreaterThanOrEqual(before);
    const days = (data.expiresAt.getTime() - data.startedAt.getTime()) / DAY;
    expect(days).toBeGreaterThanOrEqual(28);
    expect(days).toBeLessThanOrEqual(31);
  });
});

describe("renewVipSubscription", () => {
  const renewal = { ...base, renewalFromSubscriptionId: "sub-old" };

  function source(overrides: Record<string, unknown> = {}) {
    return {
      id: "sub-old",
      userId: "u1",
      status: "ACTIVE",
      plan: { code: "VIP_1M" },
      expiresAt: new Date(Date.now() + 10 * DAY),
      ...overrides,
    };
  }

  function arrange(src: unknown, target = subscription()) {
    tx.vipSubscription.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === "sub-old" ? src : target,
    );
  }

  it("keeps the time that is still paid for on the active source", async () => {
    arrange(source());
    await renewVipSubscription(renewal);
    const data = tx.vipSubscription.update.mock.calls[0][0].data;
    const days = (data.expiresAt.getTime() - Date.now()) / DAY;
    expect(days).toBeGreaterThan(36); // a month (28-31 days) plus the ~10 remaining days
  });

  it("gives no carried-over time from a source that was refunded in the meantime", async () => {
    arrange(source({ status: "REFUNDED" }));
    await renewVipSubscription(renewal);
    const data = tx.vipSubscription.update.mock.calls[0][0].data;
    const days = (data.expiresAt.getTime() - Date.now()) / DAY;
    expect(days).toBeLessThanOrEqual(31);
  });

  it("only cancels a source that is still active", async () => {
    arrange(source());
    await renewVipSubscription(renewal);
    expect(tx.vipSubscription.updateMany).toHaveBeenCalledWith({
      where: { id: "sub-old", status: "ACTIVE" },
      data: { status: "CANCELED" },
    });
  });

  it("the same payment delivered twice without an event id extends nothing the second time", async () => {
    arrange(source(), subscription({ status: "ACTIVE", paymentId: "pay_1" }));
    await expect(renewVipSubscription(renewal)).resolves.toMatchObject({ reused: true });
    expect(tx.vipSubscription.update).not.toHaveBeenCalled();
    expect(tx.aiCreditBalance.upsert).not.toHaveBeenCalled();
  });

  it("rejects a renewal source that belongs to someone else", async () => {
    arrange(source({ userId: "someone-else" }));
    await expect(renewVipSubscription(renewal)).rejects.toThrow("VIP_RENEWAL_SOURCE_MISMATCH");
  });

  it("rejects a closed target and a wrong amount", async () => {
    arrange(source(), subscription({ status: "REFUNDED" }));
    await expect(renewVipSubscription(renewal)).rejects.toThrow("VIP_SUBSCRIPTION_NOT_ACTIVATABLE");
    arrange(source());
    await expect(renewVipSubscription({ ...renewal, amountCents: 1 })).rejects.toThrow("VIP_PAYMENT_AMOUNT_MISMATCH");
  });
});

describe("serializable retry", () => {
  it("retries a lost serialization race and then succeeds", async () => {
    tx.vipSubscription.findUnique.mockResolvedValue(subscription());
    dbMock.$transaction.mockRejectedValueOnce(Object.assign(new Error("conflict"), { code: "P2034" }));
    await expect(activateVipSubscription(base)).resolves.toMatchObject({ reused: false });
    expect(dbMock.$transaction).toHaveBeenCalledTimes(2);
  });

  it("does not retry other errors", async () => {
    dbMock.$transaction.mockRejectedValueOnce(new Error("boom"));
    await expect(activateVipSubscription(base)).rejects.toThrow("boom");
    expect(dbMock.$transaction).toHaveBeenCalledTimes(1);
  });
});
