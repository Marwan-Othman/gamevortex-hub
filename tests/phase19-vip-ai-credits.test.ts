/**
 * Phase 19 - VIP, expired subscriptions and AI credits
 *
 * The real lib/vip.ts and lib/ai/credits.ts run against a small stateful fake of the database.
 * The fake EVALUATES the `where` clauses the code sends (status = ACTIVE and expiresAt either null
 * or in the future), so an expired subscription is rejected because the query is right, not because
 * a mock was told to return nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state: any = {};
  let lock: Promise<unknown> = Promise.resolve();
  const dup = () => Object.assign(new Error("Unique constraint failed"), { code: "P2002", name: "PrismaClientKnownRequestError" });

  const matchesSubscription = (sub: any, where: any) => {
    if (sub.userId !== where.userId || sub.status !== where.status) return false;
    return (where.OR as any[]).some((cond) => {
      if (cond.expiresAt === null) return sub.expiresAt === null;
      if (cond.expiresAt?.gt) return sub.expiresAt !== null && sub.expiresAt > cond.expiresAt.gt;
      return false;
    });
  };

  const api: any = {
    user: { findUnique: vi.fn(async ({ where }: any) => (state.users.has(where.id) ? { ...state.users.get(where.id) } : null)) },
    vipSubscription: {
      findFirst: vi.fn(async ({ where }: any) => state.subs.find((s: any) => matchesSubscription(s, where)) ?? null),
    },
    aiCreditBalance: {
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const existing = state.balances.get(where.userId);
        if (!existing) {
          state.balances.set(where.userId, { gvcBalance: create.gvcBalance ?? 0 });
        } else if (update?.gvcBalance?.increment) {
          existing.gvcBalance += update.gvcBalance.increment;
        }
        return state.balances.get(where.userId);
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const row = state.balances.get(where.userId);
        if (!row || row.gvcBalance < where.gvcBalance.gte) return { count: 0 };
        row.gvcBalance -= data.gvcBalance.decrement;
        return { count: 1 };
      }),
    },
    aiCreditLedger: {
      findUnique: vi.fn(async ({ where }: any) => state.ledger.get(where.idempotencyKey) ?? null),
      create: vi.fn(async ({ data }: any) => {
        if (state.ledger.has(data.idempotencyKey)) throw dup();
        state.ledger.set(data.idempotencyKey, { ...data });
        return data;
      }),
    },
  };

  const db: any = {
    ...api,
    $transaction: vi.fn(),
  };
  const serialized = async (work: (t: any) => Promise<unknown>) => {
    const run = lock.then(async () => {
      const before = {
        balances: new Map([...state.balances].map(([k, v]: any) => [k, { ...v }])),
        ledger: new Map(state.ledger),
      };
      try {
        return await work(api);
      } catch (error) {
        state.balances = before.balances;
        state.ledger = before.ledger;
        throw error;
      }
    });
    lock = run.catch(() => undefined);
    return run;
  };
  return { state, db, serialized, logSystemError: vi.fn(), getVipSubscriptionStatus: vi.fn(), expireDue: vi.fn(), requireUser: vi.fn() };
});

vi.mock("@/lib/prisma", () => ({ db: h.db, prisma: h.db }));
vi.mock("@/lib/observability", () => ({ logSystemError: h.logSystemError }));
vi.mock("@/lib/auth", () => ({ requireUser: h.requireUser }));
vi.mock("@/lib/vip-subscriptions", () => ({
  getVipSubscriptionStatus: h.getVipSubscriptionStatus,
  expireDueVipSubscriptions: h.expireDue,
}));

import { Prisma } from "@prisma/client";
import { applyVipPointsMultiplier, getVipAccess, requireActiveVip } from "@/lib/vip";
import { consumeAiCredit, getGvcBalance, refundAiCredit } from "@/lib/ai/credits";
import { GET as vipStatusGet } from "@/app/api/vip/status/route";
import { GET as cronGet } from "@/app/api/cron/vip-expiry/route";
import { dbDownError, makeRequest } from "./helpers/phase19";

const HOUR = 3_600_000;
const inFuture = (ms = HOUR) => new Date(Date.now() + ms);
const inPast = (ms = HOUR) => new Date(Date.now() - ms);

function subscription(userId: string, over: Record<string, unknown> = {}) {
  return {
    id: `sub_${userId}`,
    userId,
    status: "ACTIVE",
    expiresAt: inFuture(24 * HOUR),
    startedAt: inPast(24 * HOUR),
    plan: { code: "VIP_MONTHLY", pointsMultiplier: 2 },
    ...over,
  };
}

const KEY = "ai-request-key-000001";
const balanceOf = (id: string) => h.state.balances.get(id)?.gvcBalance;

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.clearAllMocks();
  h.state.users = new Map([
    ["vip_user", { id: "vip_user", role: "USER" }],
    ["free_user", { id: "free_user", role: "USER" }],
    ["owner", { id: "owner", role: "SUPER_ADMIN" }],
  ]);
  h.state.subs = [subscription("vip_user")];
  h.state.balances = new Map([["vip_user", { gvcBalance: 100 }]]);
  h.state.ledger = new Map();
  h.db.$transaction.mockReset();
  h.db.$transaction.mockImplementation(h.serialized);
  h.logSystemError.mockResolvedValue(undefined);
  h.requireUser.mockReset();
  h.requireUser.mockResolvedValue({ id: "vip_user" });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/* ================================================================== */
describe("VIP access (getVipAccess)", () => {
  it("success: an active subscription gives VIP with its plan and multiplier", async () => {
    const access = await getVipAccess("vip_user");
    expect(access).toMatchObject({ isVip: true, isOwner: false, status: "ACTIVE", planCode: "VIP_MONTHLY", pointsMultiplier: 2 });
    expect(access.subscriptionId).toBe("sub_vip_user");
  });

  it("success: the owner (SUPER_ADMIN) is permanent VIP without any subscription row", async () => {
    const access = await getVipAccess("owner");
    expect(access).toMatchObject({ isVip: true, isOwner: true, planCode: "OWNER", status: "OWNER", expiresAt: null });
  });

  it("success: an active subscription with no end date stays valid", async () => {
    h.state.subs = [subscription("vip_user", { expiresAt: null })];
    expect((await getVipAccess("vip_user")).isVip).toBe(true);
  });

  it("expired subscription: one that ended a moment ago gives FREE access even though its status is still ACTIVE", async () => {
    h.state.subs = [subscription("vip_user", { expiresAt: inPast(1) })];
    const access = await getVipAccess("vip_user");
    expect(access).toMatchObject({ isVip: false, planCode: "FREE", status: "NONE", pointsMultiplier: 1, subscriptionId: null });
  });

  it("expired subscription: one that ends in the future is still valid (boundary)", async () => {
    h.state.subs = [subscription("vip_user", { expiresAt: inFuture(60_000) })];
    expect((await getVipAccess("vip_user")).isVip).toBe(true);
  });

  it("expired subscription: EXPIRED, CANCELED, REFUNDED and PENDING statuses never grant VIP", async () => {
    for (const status of ["EXPIRED", "CANCELED", "REFUNDED", "PENDING"]) {
      h.state.subs = [subscription("vip_user", { status })];
      expect((await getVipAccess("vip_user")).isVip).toBe(false);
    }
  });

  it("failure: a user with no subscription is FREE; another user's subscription does not leak across", async () => {
    expect((await getVipAccess("free_user")).isVip).toBe(false);
  });

  it("invalid data: an out-of-range plan multiplier falls back to 1 instead of inflating rewards", async () => {
    for (const bad of [0.5, 0, -3, 1000, Number.NaN]) {
      h.state.subs = [subscription("vip_user", { plan: { code: "VIP_MONTHLY", pointsMultiplier: bad } })];
      expect((await getVipAccess("vip_user")).pointsMultiplier).toBe(1);
    }
  });

  it("invalid data: empty id and unknown user are refused", async () => {
    await expect(getVipAccess("")).rejects.toThrow("USER_ID_REQUIRED");
    await expect(getVipAccess("ghost")).rejects.toThrow("USER_NOT_FOUND");
  });

  it("database failure: an outage is thrown, never silently treated as 'free' or 'VIP'", async () => {
    h.db.user.findUnique.mockRejectedValueOnce(dbDownError());
    await expect(getVipAccess("vip_user")).rejects.toThrow(/reach database/);
    h.db.vipSubscription.findFirst.mockRejectedValueOnce(dbDownError());
    await expect(getVipAccess("vip_user")).rejects.toThrow(/reach database/);
  });

  it("requireActiveVip: refuses free and expired users with VIP_REQUIRED, accepts VIP and the owner", async () => {
    await expect(requireActiveVip("free_user")).rejects.toThrow("VIP_REQUIRED");
    h.state.subs = [subscription("vip_user", { expiresAt: inPast() })];
    await expect(requireActiveVip("vip_user")).rejects.toThrow("VIP_REQUIRED");
    await expect(requireActiveVip("owner")).resolves.toMatchObject({ isOwner: true });
  });

  it("applyVipPointsMultiplier: rounds down and rejects invalid inputs", () => {
    expect(applyVipPointsMultiplier(199, 1.5)).toBe(298);
    expect(applyVipPointsMultiplier(10, 1)).toBe(10);
    for (const base of [0, -1, 1.5, Number.NaN]) expect(() => applyVipPointsMultiplier(base, 2)).toThrow("INVALID_BASE_POINTS");
    for (const mult of [0.99, 101, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => applyVipPointsMultiplier(10, mult)).toThrow("INVALID_VIP_MULTIPLIER");
  });
});

/* ================================================================== */
describe("GET /api/vip/status", () => {
  const status = () => vipStatusGet(makeRequest("/api/vip/status"));

  it("success: returns the status computed by the server for the signed-in user", async () => {
    h.getVipSubscriptionStatus.mockResolvedValue({ isVip: true, status: "ACTIVE" });
    const response = await status();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { isVip: true, status: "ACTIVE" } });
    expect(h.getVipSubscriptionStatus).toHaveBeenCalledWith("vip_user");
  });

  it("expired subscription: an expired user is reported as not VIP, not as an error", async () => {
    h.getVipSubscriptionStatus.mockResolvedValue({ isVip: false, status: "NONE", planCode: "FREE" });
    const response = await status();
    expect(response.status).toBe(200);
    expect((await response.json()).data.isVip).toBe(false);
  });

  it("unauthorized: 401 and no lookup", async () => {
    h.requireUser.mockRejectedValue(new Error("UNAUTHORIZED"));
    const response = await status();
    expect(response.status).toBe(401);
    expect(h.getVipSubscriptionStatus).not.toHaveBeenCalled();
  });

  it("database failure: a failing lookup is 500 VIP_STATUS_FAILED without internals", async () => {
    h.getVipSubscriptionStatus.mockRejectedValue(new Error('relation "VipSubscription" does not exist'));
    const response = await status();
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(text).toContain("VIP_STATUS_FAILED");
    expect(text).not.toContain("relation");
  });
});

/* ================================================================== */
describe("GET /api/cron/vip-expiry", () => {
  const SECRET = "cron-secret-0123456789-abcdef";
  const cron = (authorization?: string) =>
    cronGet(makeRequest("/api/cron/vip-expiry", { headers: authorization ? { authorization } : {} }));

  it("success: the right bearer secret runs the job and reports its result", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    h.expireDue.mockResolvedValue({ expired: 3 });
    const response = await cron(`Bearer ${SECRET}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, expired: 3 });
    expect(h.expireDue).toHaveBeenCalledWith(500);
  });

  it("empty data: nothing due is still a clean 200", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    h.expireDue.mockResolvedValue({ expired: 0 });
    expect((await cron(`Bearer ${SECRET}`)).status).toBe(200);
  });

  it("unauthorized: no header, wrong secret, wrong scheme and a prefix of the secret are all 401", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    for (const header of [undefined, "Bearer wrong-secret-0123456789", `Basic ${SECRET}`, SECRET, `Bearer ${SECRET.slice(0, -1)}`]) {
      expect((await cron(header)).status).toBe(401);
    }
    expect(h.expireDue).not.toHaveBeenCalled();
  });

  it("unauthorized: a missing or short CRON_SECRET disables the endpoint completely", async () => {
    h.expireDue.mockResolvedValue({ expired: 0 });
    expect((await cron("Bearer ")).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "short");
    expect((await cron("Bearer short")).status).toBe(401);
    expect(h.expireDue).not.toHaveBeenCalled();
  });

  it("failure: a failing job is 500 VIP_EXPIRY_FAILED and is recorded for the operator", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    h.expireDue.mockRejectedValue(dbDownError());
    const response = await cron(`Bearer ${SECRET}`);
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(text).toContain("VIP_EXPIRY_FAILED");
    expect(text).not.toContain("db.internal");
    expect(h.logSystemError).toHaveBeenCalledWith("vip:expiry-cron-failed", expect.anything());
  });
});

/* ================================================================== */
describe("AI credits: consumeAiCredit", () => {
  it("success: takes the credits and records the reservation", async () => {
    await expect(consumeAiCredit("vip_user", "IMAGE", KEY, 10)).resolves.toEqual({ consumed: true, alreadyApplied: false, amount: 10 });
    expect(balanceOf("vip_user")).toBe(90);
    expect(h.state.ledger.get(`vip_user:${KEY}`)).toMatchObject({ delta: -10, kind: "IMAGE", reason: "AI_GVC_RESERVATION" });
  });

  it("success: spending the whole balance is allowed and leaves zero", async () => {
    await consumeAiCredit("vip_user", "VIDEO", KEY, 100);
    expect(balanceOf("vip_user")).toBe(0);
  });

  it("insufficient balance: refused with AI_CREDITS_EXHAUSTED, nothing taken or recorded", async () => {
    await expect(consumeAiCredit("vip_user", "VIDEO", KEY, 101)).rejects.toThrow("AI_CREDITS_EXHAUSTED");
    expect(balanceOf("vip_user")).toBe(100);
    expect(h.state.ledger.size).toBe(0);
  });

  it("insufficient balance: a VIP who never had a balance row is refused, not crashed", async () => {
    h.state.balances.delete("vip_user");
    await expect(consumeAiCredit("vip_user", "CHAT", KEY, 1)).rejects.toThrow("AI_CREDITS_EXHAUSTED");
  });

  it("expired subscription: credits cannot be spent after the subscription ended, even with a full balance", async () => {
    h.state.subs = [subscription("vip_user", { expiresAt: inPast() })];
    await expect(consumeAiCredit("vip_user", "IMAGE", KEY, 10)).rejects.toThrow("AI_VIP_REQUIRED");
    expect(balanceOf("vip_user")).toBe(100);
    expect(h.state.ledger.size).toBe(0);
  });

  it("expired subscription: refunded/canceled subscriptions, free users and unknown users cannot spend either", async () => {
    h.state.balances.set("free_user", { gvcBalance: 500 });
    await expect(consumeAiCredit("free_user", "IMAGE", KEY, 10)).rejects.toThrow("AI_VIP_REQUIRED");
    await expect(consumeAiCredit("ghost", "IMAGE", KEY, 10)).rejects.toThrow("AI_VIP_REQUIRED");
    for (const status of ["REFUNDED", "CANCELED", "EXPIRED"]) {
      h.state.subs = [subscription("vip_user", { status })];
      await expect(consumeAiCredit("vip_user", "IMAGE", `${KEY}-${status}`, 10)).rejects.toThrow("AI_VIP_REQUIRED");
    }
    expect(balanceOf("free_user")).toBe(500);
    expect(balanceOf("vip_user")).toBe(100);
  });

  it("invalid data: bad amounts, empty user or empty key are refused before the database", async () => {
    for (const amount of [0, -1, 1.5, Number.NaN, 2 ** 60]) {
      await expect(consumeAiCredit("vip_user", "IMAGE", KEY, amount)).rejects.toThrow("INVALID_CREDIT_REQUEST");
    }
    await expect(consumeAiCredit("", "IMAGE", KEY, 1)).rejects.toThrow("INVALID_CREDIT_REQUEST");
    await expect(consumeAiCredit("vip_user", "IMAGE", "", 1)).rejects.toThrow("INVALID_CREDIT_REQUEST");
    expect(h.db.$transaction).not.toHaveBeenCalled();
  });

  it("duplicate request: replaying the same reservation takes nothing more and says alreadyApplied", async () => {
    await consumeAiCredit("vip_user", "IMAGE", KEY, 10);
    await expect(consumeAiCredit("vip_user", "IMAGE", KEY, 10)).resolves.toEqual({ consumed: true, alreadyApplied: true, amount: 10 });
    expect(balanceOf("vip_user")).toBe(90);
  });

  it("duplicate request: a key cannot be reused for a different amount or kind (no free work)", async () => {
    await consumeAiCredit("vip_user", "IMAGE", KEY, 10);
    await expect(consumeAiCredit("vip_user", "IMAGE", KEY, 5)).rejects.toThrow("AI_IDEMPOTENCY_KEY_CONFLICT");
    await expect(consumeAiCredit("vip_user", "VIDEO", KEY, 10)).rejects.toThrow("AI_IDEMPOTENCY_KEY_CONFLICT");
    expect(balanceOf("vip_user")).toBe(90);
  });

  it("duplicate request: a key whose reservation was already refunded cannot be replayed", async () => {
    await consumeAiCredit("vip_user", "IMAGE", KEY, 10);
    await refundAiCredit("vip_user", "IMAGE", KEY, 10);
    await expect(consumeAiCredit("vip_user", "IMAGE", KEY, 10)).rejects.toThrow("AI_IDEMPOTENCY_KEY_CONFLICT");
  });

  it("duplicate request: two users using the same client key do not collide", async () => {
    h.state.users.set("vip_2", { id: "vip_2", role: "USER" });
    h.state.subs.push(subscription("vip_2"));
    h.state.balances.set("vip_2", { gvcBalance: 100 });
    await consumeAiCredit("vip_user", "IMAGE", KEY, 10);
    await expect(consumeAiCredit("vip_2", "IMAGE", KEY, 10)).resolves.toMatchObject({ alreadyApplied: false });
    expect(balanceOf("vip_2")).toBe(90);
  });

  it("concurrent request: five parallel 40-credit requests on a balance of 100 -> exactly two succeed, never negative", async () => {
    const results = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => consumeAiCredit("vip_user", "VIDEO", `${KEY}-${i}`, 40)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(failed.every((r) => r.reason.message === "AI_CREDITS_EXHAUSTED")).toBe(true);
    expect(balanceOf("vip_user")).toBe(20);
    expect(h.state.ledger.size).toBe(2);
  });

  it("concurrent request: five parallel copies of the SAME request charge exactly once", async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => consumeAiCredit("vip_user", "IMAGE", KEY, 10)));
    expect(results.filter((r) => !r.alreadyApplied)).toHaveLength(1);
    expect(results.filter((r) => r.alreadyApplied)).toHaveLength(4);
    expect(balanceOf("vip_user")).toBe(90);
  });

  it("concurrent request: losing a unique-key race (P2002) reports the winner's reservation instead of failing", async () => {
    h.state.ledger.set(`vip_user:${KEY}`, { delta: -10, kind: "IMAGE" });
    h.db.$transaction
      .mockImplementationOnce(async () => {
        throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });
      })
      .mockImplementation(h.serialized);
    await expect(consumeAiCredit("vip_user", "IMAGE", KEY, 10)).resolves.toEqual({ consumed: true, alreadyApplied: true, amount: 10 });
    expect(balanceOf("vip_user")).toBe(100); // the loser took nothing
  });

  it("database failure: an outage surfaces and nothing is taken", async () => {
    h.db.$transaction.mockRejectedValueOnce(dbDownError());
    await expect(consumeAiCredit("vip_user", "IMAGE", KEY, 10)).rejects.toThrow(/reach database/);
    expect(balanceOf("vip_user")).toBe(100);
  });

  it("database failure: a crash after the balance was taken but before the ledger row rolls the balance back", async () => {
    h.db.aiCreditLedger.create.mockRejectedValueOnce(new Error("disk full"));
    await expect(consumeAiCredit("vip_user", "IMAGE", KEY, 10)).rejects.toThrow("disk full");
    expect(balanceOf("vip_user")).toBe(100);
    expect(h.state.ledger.size).toBe(0);
  });
});

/* ================================================================== */
describe("AI credits: refundAiCredit", () => {
  beforeEach(async () => {
    await consumeAiCredit("vip_user", "IMAGE", KEY, 10);
  });

  it("success: returns the reserved credits and records the refund", async () => {
    await expect(refundAiCredit("vip_user", "IMAGE", KEY, 10)).resolves.toEqual({ refunded: true, alreadyApplied: false, amount: 10 });
    expect(balanceOf("vip_user")).toBe(100);
    expect(h.state.ledger.get(`vip_user:refund:${KEY}`)).toMatchObject({ delta: 10, reason: "AI_GVC_REFUND" });
  });

  it("duplicate request: refunding twice gives the credits back once", async () => {
    await refundAiCredit("vip_user", "IMAGE", KEY, 10);
    await expect(refundAiCredit("vip_user", "IMAGE", KEY, 10)).resolves.toMatchObject({ alreadyApplied: true });
    expect(balanceOf("vip_user")).toBe(100);
  });

  it("concurrent request: five parallel refunds restore the balance once", async () => {
    await Promise.all(Array.from({ length: 5 }, () => refundAiCredit("vip_user", "IMAGE", KEY, 10)));
    expect(balanceOf("vip_user")).toBe(100);
    expect([...h.state.ledger.keys()].filter((k) => k.includes("refund"))).toHaveLength(1);
  });

  it("failure: refunding something that was never reserved, or more than was reserved, is refused", async () => {
    await expect(refundAiCredit("vip_user", "IMAGE", "never-reserved-key-1", 10)).rejects.toThrow("AI_CREDIT_RESERVATION_NOT_FOUND");
    await expect(refundAiCredit("vip_user", "IMAGE", KEY, 11)).rejects.toThrow("AI_CREDIT_REFUND_EXCEEDS_RESERVATION");
    expect(balanceOf("vip_user")).toBe(90);
  });

  it("invalid data: bad amounts and empty identifiers are refused", async () => {
    for (const amount of [0, -1, 1.5, Number.NaN]) {
      await expect(refundAiCredit("vip_user", "IMAGE", KEY, amount)).rejects.toThrow("INVALID_CREDIT_REQUEST");
    }
    await expect(refundAiCredit("", "IMAGE", KEY, 1)).rejects.toThrow("INVALID_CREDIT_REQUEST");
  });

  it("database failure: a refund that could not be written is logged for the operator and rethrown", async () => {
    h.db.$transaction.mockRejectedValueOnce(dbDownError());
    await expect(refundAiCredit("vip_user", "IMAGE", KEY, 10)).rejects.toThrow(/reach database/);
    expect(h.logSystemError).toHaveBeenCalledWith(
      "ai:credit-refund-failed",
      expect.anything(),
      expect.objectContaining({ userId: "vip_user" }),
    );
    expect(balanceOf("vip_user")).toBe(90);
  });

  it("works after a subscription expired: a user is always refunded for a failed generation", async () => {
    h.state.subs = [subscription("vip_user", { expiresAt: inPast() })];
    await expect(refundAiCredit("vip_user", "IMAGE", KEY, 10)).resolves.toMatchObject({ refunded: true });
    expect(balanceOf("vip_user")).toBe(100);
  });
});

describe("AI credits: getGvcBalance", () => {
  it("returns the balance, 0 when there is no row, and refuses an empty id", async () => {
    h.db.aiCreditBalance.findUnique = vi.fn().mockResolvedValueOnce({ gvcBalance: 42 }).mockResolvedValueOnce(null);
    await expect(getGvcBalance("vip_user")).resolves.toBe(42);
    await expect(getGvcBalance("vip_user")).resolves.toBe(0);
    await expect(getGvcBalance("")).rejects.toThrow("USER_ID_REQUIRED");
  });
});
