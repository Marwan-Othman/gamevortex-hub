/**
 * Phase 19 - Admin & Owner
 *
 * Authorization here is REAL: lib/auth.ts reads a signed session cookie and the role comes from the
 * (faked) database row, so "a STAFF member cannot call an owner route" is proven end to end and not
 * just by telling a mock to throw FORBIDDEN.
 *
 * Covered routes: /api/admin/users, /api/admin/owner-control, /api/admin/api-keys(+[id]),
 * /api/admin/withdrawals/[id], /api/owner/withdraw.
 */
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const jar = new Map<string, string>();
  const users = new Map<string, Record<string, any>>();
  const cookieStore = {
    get: vi.fn((name: string) => (jar.has(name) ? { name, value: jar.get(name) as string } : undefined)),
    set: vi.fn(),
    delete: vi.fn(),
  };

  /* ---- owner wallet state (for the withdraw route) ---- */
  const ow: any = { wallet: null, withdrawals: new Map(), ledger: [], audits: [], lock: Promise.resolve() };
  const impl = {
    walletFind: async () => ow.wallet,
    walletUpdateMany: async ({ where, data }: any) => {
      if (!ow.wallet || ow.wallet.id !== where.id) return { count: 0 };
      if (where.availablePoints && ow.wallet.availablePoints < where.availablePoints.gte) return { count: 0 };
      if (where.pendingPoints && ow.wallet.pendingPoints < where.pendingPoints.gte) return { count: 0 };
      for (const [key, delta] of Object.entries<any>(data)) {
        ow.wallet[key] += (delta.increment ?? 0) - (delta.decrement ?? 0);
      }
      return { count: 1 };
    },
    withdrawalFind: async ({ where }: any) => {
      if (where.idempotencyKey) return ow.withdrawals.get(where.idempotencyKey) ?? null;
      return [...ow.withdrawals.values()].find((w: any) => w.id === where.id) ?? null;
    },
    withdrawalCreate: async ({ data }: any) => {
      if (ow.withdrawals.has(data.idempotencyKey)) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      const row = { id: `wd_${ow.withdrawals.size + 1}`, ...data };
      ow.withdrawals.set(data.idempotencyKey, row);
      return row;
    },
    ledgerCreate: async ({ data }: any) => {
      ow.ledger.push(data);
      return data;
    },
    auditCreate: async ({ data }: any) => {
      ow.audits.push(data);
      return data;
    },
  };
  const owTx: any = {
    ownerWallet: { findUnique: vi.fn(impl.walletFind), updateMany: vi.fn(impl.walletUpdateMany) },
    withdrawalRequest: { findUnique: vi.fn(impl.withdrawalFind), create: vi.fn(impl.withdrawalCreate), update: vi.fn() },
    ownerLedger: { create: vi.fn(impl.ledgerCreate) },
    auditLog: { create: vi.fn(impl.auditCreate) },
    $queryRaw: vi.fn(async () => []),
    user: { update: vi.fn(), findUnique: vi.fn() },
    gameVortexApiKey: { create: vi.fn(), update: vi.fn() },
  };
  /** Puts every transaction-level fake back to its default behaviour (independent of the vitest version's mockReset rules). */
  const resetOwTx = () => {
    owTx.ownerWallet.findUnique.mockReset();
    owTx.ownerWallet.findUnique.mockImplementation(impl.walletFind);
    owTx.ownerWallet.updateMany.mockReset();
    owTx.ownerWallet.updateMany.mockImplementation(impl.walletUpdateMany);
    owTx.withdrawalRequest.findUnique.mockReset();
    owTx.withdrawalRequest.findUnique.mockImplementation(impl.withdrawalFind);
    owTx.withdrawalRequest.create.mockReset();
    owTx.withdrawalRequest.create.mockImplementation(impl.withdrawalCreate);
    owTx.withdrawalRequest.update.mockReset();
    owTx.ownerLedger.create.mockReset();
    owTx.ownerLedger.create.mockImplementation(impl.ledgerCreate);
    owTx.auditLog.create.mockReset();
    owTx.auditLog.create.mockImplementation(impl.auditCreate);
    owTx.user.update.mockReset();
    owTx.gameVortexApiKey.create.mockReset();
    owTx.gameVortexApiKey.update.mockReset();
  };
  const serialized = async (work: (t: any) => Promise<unknown>) => {
    const run = ow.lock.then(async () => {
      const snapshot = { wallet: ow.wallet && { ...ow.wallet }, withdrawals: new Map(ow.withdrawals), ledger: [...ow.ledger], audits: [...ow.audits] };
      try {
        return await work(owTx);
      } catch (error) {
        Object.assign(ow, snapshot);
        throw error;
      }
    });
    ow.lock = run.catch(() => undefined);
    return run;
  };

  const db: any = {
    user: { findUnique: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
    game: { count: vi.fn() },
    gameProduct: { count: vi.fn() },
    order: { count: vi.fn() },
    payment: { count: vi.fn() },
    withdrawalRequest: { count: vi.fn() },
    vipSubscription: { count: vi.fn() },
    systemError: { count: vi.fn() },
    contentReport: { count: vi.fn() },
    gameVortexApiKey: { findMany: vi.fn(), findUnique: vi.fn() },
    $transaction: vi.fn(),
  };
  return { jar, users, cookieStore, ow, owTx, resetOwTx, serialized, db, logSystemError: vi.fn() };
});

vi.mock("next/headers", () => ({ cookies: async () => h.cookieStore }));
vi.mock("@/lib/prisma", () => ({ db: h.db, prisma: h.db }));
vi.mock("@/lib/observability", () => ({ logSystemError: h.logSystemError }));

import { Prisma } from "@prisma/client";
import { GET as usersGet } from "@/app/api/admin/users/route";
import { GET as controlGet, PATCH as controlPatch } from "@/app/api/admin/owner-control/route";
import { GET as keysGet, POST as keysPost } from "@/app/api/admin/api-keys/route";
import { PATCH as keyRevoke } from "@/app/api/admin/api-keys/[id]/route";
import { PATCH as withdrawalPatch } from "@/app/api/admin/withdrawals/[id]/route";
import { POST as withdrawPost } from "@/app/api/owner/withdraw/route";
import { pointsToUsd } from "@/lib/owner-points";
import { dbDownError, makeRequest, routeParams } from "./helpers/phase19";

const SECRET = "phase19-admin-secret-0123456789-abcdef-XYZ";
const OWNER_ID = "cmowner00000000000000000001";
const TARGET_ID = "cmtarget0000000000000000001";
const OWNER_EMAIL = "owner@gamevortex.example";

function forgeToken(sub: string, sv: number) {
  const body = Buffer.from(JSON.stringify({ sub, sv, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return `${body}.${createHmac("sha256", SECRET).update(body).digest("base64url")}`;
}

function addUser(id: string, role: string, email = `${id}@example.com`) {
  const user = { id, role, email, username: id, points: 0, sessionVersion: 1 };
  h.users.set(id, user);
  return user;
}

/** Signs the browser in as the given role. */
function signInAs(role: "SUPER_ADMIN" | "STAFF" | "USER", id = OWNER_ID) {
  const user = addUser(id, role, role === "SUPER_ADMIN" ? OWNER_EMAIL : undefined);
  h.jar.set("gv_session", forgeToken(user.id, user.sessionVersion));
  return user;
}

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", SECRET);
  vi.stubEnv("APP_ORIGIN", "");
  vi.stubEnv("OWNER_EMAIL", OWNER_EMAIL);
  vi.stubEnv("OWNER_WITHDRAWAL_ENABLED", "true");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.clearAllMocks();
  h.jar.clear();
  h.users.clear();
  h.ow.wallet = null;
  h.ow.withdrawals = new Map();
  h.ow.ledger = [];
  h.ow.audits = [];
  h.ow.lock = Promise.resolve();

  h.db.user.findUnique.mockReset();
  h.db.user.findUnique.mockImplementation(async ({ where }: any) => h.users.get(where.id) ?? null);
  for (const group of ["findMany", "findFirst", "count"] as const) h.db.user[group].mockReset();
  h.db.user.findMany.mockResolvedValue([]);
  h.db.user.findFirst.mockResolvedValue(null);
  for (const table of ["game", "gameProduct", "order", "payment", "withdrawalRequest", "vipSubscription", "systemError", "contentReport"]) {
    h.db[table].count.mockReset();
    h.db[table].count.mockResolvedValue(0);
  }
  h.db.user.count.mockResolvedValue(3);
  h.db.gameVortexApiKey.findMany.mockReset();
  h.db.gameVortexApiKey.findMany.mockResolvedValue([]);
  h.db.gameVortexApiKey.findUnique.mockReset();
  h.db.$transaction.mockReset();
  h.db.$transaction.mockImplementation(async (work: any) => work(h.owTx));
  h.resetOwTx();
  h.logSystemError.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/* ================================================================== */
describe("Authorization matrix: every admin/owner route", () => {
  const params = routeParams({ id: TARGET_ID });
  const routes: Array<[string, () => Promise<Response>]> = [
    ["GET /api/admin/users", () => usersGet(makeRequest("/api/admin/users"))],
    ["GET /api/admin/owner-control", () => controlGet(makeRequest("/api/admin/owner-control"))],
    ["PATCH /api/admin/owner-control", () => controlPatch(makeRequest("/api/admin/owner-control", { method: "PATCH", body: { userId: TARGET_ID, role: "STAFF" } }))],
    ["GET /api/admin/api-keys", () => keysGet(makeRequest("/api/admin/api-keys"))],
    ["POST /api/admin/api-keys", () => keysPost(makeRequest("/api/admin/api-keys", { body: { email: "a@b.co", label: "x" } }))],
    ["PATCH /api/admin/api-keys/[id]", () => keyRevoke(makeRequest("/api/admin/api-keys/x", { method: "PATCH" }), params)],
    ["PATCH /api/admin/withdrawals/[id]", () => withdrawalPatch(makeRequest("/api/admin/withdrawals/x", { method: "PATCH", body: { status: "PROCESSING" } }), params)],
    ["POST /api/owner/withdraw", () => withdrawPost(makeRequest("/api/owner/withdraw", { body: { points: 300, idempotencyKey: "k-000001" } }))],
  ];

  it.each(routes)("unauthorized: %s -> 401 when signed out", async (_name, call) => {
    const response = await call();
    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe("UNAUTHORIZED");
  });

  it.each(routes)("forbidden: %s -> 403 for a normal USER", async (_name, call) => {
    signInAs("USER", "cmuser0000000000000000000001");
    const response = await call();
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("FORBIDDEN");
  });

  it.each(routes)("forbidden: %s -> 403 for STAFF (only the owner may use it)", async (_name, call) => {
    signInAs("STAFF", "cmstaff000000000000000000001");
    expect((await call()).status).toBe(403);
  });

  it("forbidden: none of those refusals touched the database beyond the identity lookup", async () => {
    signInAs("STAFF", "cmstaff000000000000000000001");
    for (const [, call] of routes) await call();
    expect(h.db.$transaction).not.toHaveBeenCalled();
    expect(h.db.user.findMany).not.toHaveBeenCalled();
    expect(h.db.gameVortexApiKey.findMany).not.toHaveBeenCalled();
  });

  it("forbidden: a STAFF member cannot promote themselves to owner", async () => {
    const staff = signInAs("STAFF", "cmstaff000000000000000000001");
    const response = await controlPatch(makeRequest("/api/admin/owner-control", { method: "PATCH", body: { userId: staff.id, role: "SUPER_ADMIN" } }));
    expect(response.status).toBe(403);
    expect(h.users.get(staff.id)?.role).toBe("STAFF");
    expect(h.db.$transaction).not.toHaveBeenCalled();
  });

  it("forbidden: a role demoted after the cookie was issued stops working immediately", async () => {
    const owner = signInAs("SUPER_ADMIN");
    expect((await usersGet(makeRequest("/api/admin/users"))).status).toBe(200);
    owner.role = "USER";
    expect((await usersGet(makeRequest("/api/admin/users"))).status).toBe(403);
  });
});

/* ================================================================== */
describe("GET /api/admin/users", () => {
  const list = () => usersGet(makeRequest("/api/admin/users"));

  it("success: the owner sees users, never password hashes, never cached", async () => {
    signInAs("SUPER_ADMIN");
    h.db.user.findMany.mockResolvedValue([{ id: "u1", username: "a", email: "a@b.co", role: "USER" }]);
    const response = await list();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const select = h.db.user.findMany.mock.calls[0][0].select;
    expect(select.passwordHash).toBeUndefined();
    expect(select.sessionVersion).toBeUndefined();
    expect(h.db.user.findMany.mock.calls[0][0].take).toBe(250);
  });

  it("empty data: no users -> an empty list", async () => {
    signInAs("SUPER_ADMIN");
    expect(await (await list()).json()).toEqual({ users: [] });
  });

  it("database failure: an outage is 503, not 403 (the owner must not look 'not allowed')", async () => {
    signInAs("SUPER_ADMIN");
    h.db.user.findMany.mockRejectedValue(dbDownError());
    const response = await list();
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("30");
  });

  it("database failure: the identity lookup itself failing is 503 too", async () => {
    signInAs("SUPER_ADMIN");
    h.db.user.findUnique.mockRejectedValue(dbDownError());
    expect((await list()).status).toBe(503);
  });

  it("database failure: an unexpected error is 500 ADMIN_USERS_FAILED with no internals", async () => {
    signInAs("SUPER_ADMIN");
    h.db.user.findMany.mockRejectedValue(new Error('column "ownerPoints" does not exist'));
    const response = await list();
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(text).toContain("ADMIN_USERS_FAILED");
    expect(text).not.toContain("ownerPoints");
  });
});

/* ================================================================== */
describe("GET /api/admin/owner-control", () => {
  const stats = () => controlGet(makeRequest("/api/admin/owner-control"));

  it("success: the owner sees the dashboard counters", async () => {
    signInAs("SUPER_ADMIN");
    const response = await stats();
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.stats).toMatchObject({ users: 3, games: 0, pendingWithdrawals: 0, activeVip: 0 });
    expect(json.owner.role).toBe("SUPER_ADMIN");
  });

  it("expired subscription: 'activeVip' only counts ACTIVE subscriptions that have not expired", async () => {
    signInAs("SUPER_ADMIN");
    await stats();
    const where = h.db.vipSubscription.count.mock.calls[0][0].where;
    expect(where.status).toBe("ACTIVE");
    expect(where.OR).toEqual([{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }]);
  });

  it("database failure: an outage is 503, an unexpected failure is 500 - never 403", async () => {
    signInAs("SUPER_ADMIN");
    h.db.order.count.mockRejectedValueOnce(dbDownError());
    expect((await stats()).status).toBe(503);
    h.db.order.count.mockRejectedValueOnce(new Error("relation Order missing"));
    const response = await stats();
    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe("OWNER_CONTROL_FAILED");
  });
});

describe("PATCH /api/admin/owner-control (change a role)", () => {
  const change = (body: unknown) => controlPatch(makeRequest("/api/admin/owner-control", { method: "PATCH", body }));

  beforeEach(() => {
    signInAs("SUPER_ADMIN");
    addUser(TARGET_ID, "USER", "target@example.com");
    h.owTx.user.update.mockImplementation(async ({ where, data }: any) => {
      const user = h.users.get(where.id)!;
      user.role = data.role;
      return { id: user.id, role: user.role, username: user.username, email: user.email };
    });
    h.owTx.auditLog.create.mockImplementation(async ({ data }: any) => data);
  });

  it("success: changes the role, revokes the target's sessions and writes an audit entry", async () => {
    const response = await change({ userId: TARGET_ID, role: "STAFF" });
    expect(response.status).toBe(200);
    expect(h.users.get(TARGET_ID)?.role).toBe("STAFF");
    expect(h.owTx.user.update.mock.calls[0][0].data).toEqual({ role: "STAFF", sessionVersion: { increment: 1 } });
    expect(h.owTx.auditLog.create.mock.calls[0][0].data).toMatchObject({ actorUserId: OWNER_ID, action: "OWNER_ROLE_CHANGED", entityId: TARGET_ID });
  });

  it("duplicate request: applying the same change twice is safe", async () => {
    expect((await change({ userId: TARGET_ID, role: "STAFF" })).status).toBe(200);
    expect((await change({ userId: TARGET_ID, role: "STAFF" })).status).toBe(200);
    expect(h.users.get(TARGET_ID)?.role).toBe("STAFF");
  });

  it("forbidden: the owner cannot remove their own owner role", async () => {
    const response = await change({ userId: OWNER_ID, role: "USER" });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("OWNER_ROLE_CANNOT_BE_REMOVED");
    expect(h.db.$transaction).not.toHaveBeenCalled();
  });

  it("forbidden: SUPER_ADMIN can only go to the configured owner e-mail", async () => {
    const response = await change({ userId: TARGET_ID, role: "SUPER_ADMIN" });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("ONLY_CONFIGURED_OWNER_CAN_BE_SUPER_ADMIN");
    expect(h.users.get(TARGET_ID)?.role).toBe("USER");
  });

  it("forbidden: with no OWNER_EMAIL configured nobody can be made SUPER_ADMIN", async () => {
    vi.stubEnv("OWNER_EMAIL", "");
    const response = await change({ userId: TARGET_ID, role: "SUPER_ADMIN" });
    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe("OWNER_EMAIL_NOT_CONFIGURED");
  });

  it("forbidden: a second SUPER_ADMIN is refused even for the configured e-mail", async () => {
    addUser(TARGET_ID, "USER", OWNER_EMAIL);
    h.db.user.findFirst.mockResolvedValue({ id: "someone-else" });
    const response = await change({ userId: TARGET_ID, role: "SUPER_ADMIN" });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("SUPER_ADMIN_ALREADY_EXISTS");
  });

  it("empty data: {} , null, an array or a bare string -> 400 INVALID_INPUT", async () => {
    for (const body of [{}, null, [], "text", 5]) {
      const response = await controlPatch(makeRequest("/api/admin/owner-control", { method: "PATCH", rawBody: JSON.stringify(body) }));
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe("INVALID_INPUT");
    }
  });

  it("invalid data: bad user id, unknown role, lower-case role -> 400", async () => {
    for (const body of [{ userId: "not a cuid", role: "STAFF" }, { userId: TARGET_ID, role: "ROOT" }, { userId: TARGET_ID, role: "staff" }, { userId: TARGET_ID }, { role: "STAFF" }]) {
      expect((await change(body)).status).toBe(400);
    }
    expect(h.db.$transaction).not.toHaveBeenCalled();
  });

  it("invalid data: malformed JSON -> 400 INVALID_BODY", async () => {
    const response = await controlPatch(makeRequest("/api/admin/owner-control", { method: "PATCH", rawBody: "{oops" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("INVALID_BODY");
  });

  it("failure: an unknown target user -> 404", async () => {
    const response = await change({ userId: "cmghost000000000000000000001", role: "STAFF" });
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("USER_NOT_FOUND");
  });

  it("forbidden: a cross-site Origin is refused", async () => {
    vi.stubEnv("APP_ORIGIN", "https://gamevortex.example");
    const response = await controlPatch(makeRequest("/api/admin/owner-control", { method: "PATCH", body: { userId: TARGET_ID, role: "STAFF" }, headers: { origin: "https://evil.example" } }));
    expect(response.status).toBe(403);
    expect(h.users.get(TARGET_ID)?.role).toBe("USER");
  });

  it("database failure: outage -> 503; a failing audit write -> 500 and the role change is rolled back", async () => {
    h.db.user.findUnique.mockImplementationOnce(async ({ where }: any) => h.users.get(where.id)).mockImplementationOnce(async () => {
      throw dbDownError();
    });
    expect((await change({ userId: TARGET_ID, role: "STAFF" })).status).toBe(503);

    let committed = false;
    h.db.$transaction.mockImplementation(async (work: any) => {
      const before = h.users.get(TARGET_ID)!.role;
      try {
        return await work(h.owTx);
      } catch (error) {
        h.users.get(TARGET_ID)!.role = before;
        throw error;
      } finally {
        committed = true;
      }
    });
    h.owTx.auditLog.create.mockRejectedValueOnce(new Error("audit table locked"));
    const response = await change({ userId: TARGET_ID, role: "STAFF" });
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(text).not.toContain("locked");
    expect(h.users.get(TARGET_ID)?.role).toBe("USER");
    expect(committed).toBe(true);
  });
});

/* ================================================================== */
describe("/api/admin/api-keys", () => {
  const KEY_ID = "cmkey00000000000000000000001";

  it("success: the owner lists keys without any secret material", async () => {
    signInAs("SUPER_ADMIN");
    const response = await keysGet(makeRequest("/api/admin/api-keys"));
    expect(response.status).toBe(200);
    const select = h.db.gameVortexApiKey.findMany.mock.calls[0][0].select;
    expect(select.secretHash).toBeUndefined();
  });

  it("database failure: listing during an outage is 503, not 403", async () => {
    signInAs("SUPER_ADMIN");
    h.db.gameVortexApiKey.findMany.mockRejectedValue(dbDownError());
    expect((await keysGet(makeRequest("/api/admin/api-keys"))).status).toBe(503);
  });

  describe("POST (create)", () => {
    const create = (body: unknown) => keysPost(makeRequest("/api/admin/api-keys", { body }));
    beforeEach(() => {
      signInAs("SUPER_ADMIN");
      h.db.user.findUnique.mockImplementation(async ({ where }: any) => (where.email ? { id: "cmtarget0000000000000000001" } : h.users.get(where.id) ?? null));
      h.owTx.gameVortexApiKey.create.mockImplementation(async ({ data }: any) => ({ id: KEY_ID, label: data.label, prefix: data.prefix, createdAt: new Date() }));
      h.owTx.auditLog.create.mockImplementation(async ({ data }: any) => data);
    });

    it("success: 201, the full key is shown once, only its hash is stored, and an audit entry is written", async () => {
      const response = await create({ email: "Dev@Example.com", label: "partner" });
      const json = await response.json();
      expect(response.status).toBe(201);
      expect(json.data.key).toMatch(/^gvh_live_[A-Za-z0-9_-]{43}$/);
      const stored = h.owTx.gameVortexApiKey.create.mock.calls[0][0].data;
      expect(stored.secretHash).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(stored)).not.toContain(json.data.key);
      expect(h.db.user.findUnique.mock.calls.find((c: any[]) => c[0].where.email)?.[0].where.email).toBe("dev@example.com");
      expect(h.owTx.auditLog.create.mock.calls[0][0].data.action).toBe("OWNER_API_KEY_CREATED");
      expect(JSON.stringify(h.owTx.auditLog.create.mock.calls[0][0].data)).not.toContain(json.data.key);
    });

    it("empty data / invalid data: missing or bad e-mail and label -> 400 INVALID_REQUEST", async () => {
      for (const body of [{}, { email: "a@b.co" }, { label: "x" }, { email: "nope", label: "x" }, { email: "a@b.co", label: "" }, { email: "a@b.co", label: "l".repeat(81) }]) {
        const response = await create(body);
        expect(response.status).toBe(400);
        expect((await response.json()).error).toBe("INVALID_REQUEST");
      }
      expect(h.owTx.gameVortexApiKey.create).not.toHaveBeenCalled();
    });

    it("failure: an unknown user -> 404 and no key is created", async () => {
      h.db.user.findUnique.mockImplementation(async ({ where }: any) => (where.email ? null : h.users.get(where.id) ?? null));
      const response = await create({ email: "ghost@example.com", label: "x" });
      expect(response.status).toBe(404);
      expect(h.owTx.gameVortexApiKey.create).not.toHaveBeenCalled();
    });

    it("database failure: outage -> 503; a failing audit write -> 500 OWNER_API_KEYS_FAILED and no key leaks in the body", async () => {
      h.db.$transaction.mockRejectedValueOnce(dbDownError());
      expect((await create({ email: "a@b.co", label: "x" })).status).toBe(503);

      h.owTx.auditLog.create.mockRejectedValueOnce(new Error("audit failed"));
      const response = await create({ email: "a@b.co", label: "x" });
      const text = await response.text();
      expect(response.status).toBe(500);
      expect(text).toContain("OWNER_API_KEYS_FAILED");
      expect(text).not.toContain("gvh_live_");
    });
  });

  describe("PATCH /[id] (revoke)", () => {
    const revoke = (id = KEY_ID) => keyRevoke(makeRequest(`/api/admin/api-keys/${id}`, { method: "PATCH" }), routeParams({ id }));
    beforeEach(() => {
      signInAs("SUPER_ADMIN");
      h.owTx.gameVortexApiKey.update.mockResolvedValue({});
      h.owTx.auditLog.create.mockImplementation(async ({ data }: any) => data);
    });

    it("success: revokes and audits", async () => {
      h.db.gameVortexApiKey.findUnique.mockResolvedValue({ id: KEY_ID, revokedAt: null, userId: "u1" });
      const response = await revoke();
      expect(response.status).toBe(200);
      expect(h.owTx.gameVortexApiKey.update.mock.calls[0][0].data.revokedAt).toBeInstanceOf(Date);
      expect(h.owTx.auditLog.create.mock.calls[0][0].data.action).toBe("OWNER_API_KEY_REVOKED");
    });

    it("duplicate request: revoking an already revoked key is a harmless success with no second audit entry", async () => {
      h.db.gameVortexApiKey.findUnique.mockResolvedValue({ id: KEY_ID, revokedAt: new Date(), userId: "u1" });
      const response = await revoke();
      expect(response.status).toBe(200);
      expect(h.owTx.auditLog.create).not.toHaveBeenCalled();
    });

    it("invalid data / failure: a bad id -> 400, an unknown key -> 404", async () => {
      expect((await revoke("not a cuid!")).status).toBe(400);
      h.db.gameVortexApiKey.findUnique.mockResolvedValue(null);
      expect((await revoke()).status).toBe(404);
    });

    it("database failure: outage -> 503; unexpected -> 500 (not 400)", async () => {
      h.db.gameVortexApiKey.findUnique.mockRejectedValueOnce(dbDownError());
      expect((await revoke()).status).toBe(503);
      h.db.gameVortexApiKey.findUnique.mockRejectedValueOnce(new Error("boom"));
      expect((await revoke()).status).toBe(500);
    });
  });
});

/* ================================================================== */
describe("PATCH /api/admin/withdrawals/[id]", () => {
  const WD_ID = "cmwithdrawal0000000000000001";
  const update = (body: unknown) => withdrawalPatch(makeRequest(`/api/admin/withdrawals/${WD_ID}`, { method: "PATCH", body }), routeParams({ id: WD_ID }));
  const pending = (over: Record<string, unknown> = {}) => ({
    id: WD_ID,
    status: "PENDING",
    points: 300,
    usdAmount: new Prisma.Decimal("10"),
    currency: "USD",
    conversionRate: 30,
    providerTransactionId: null,
    ownerWallet: { id: "ow1" },
    ...over,
  });

  beforeEach(() => {
    signInAs("SUPER_ADMIN");
    h.owTx.withdrawalRequest.findUnique.mockResolvedValue(pending());
    h.owTx.withdrawalRequest.update.mockImplementation(async ({ data }: any) => ({ ...pending(), ...data }));
    h.owTx.ownerWallet.updateMany.mockResolvedValue({ count: 1 });
  });

  it("success: PAID needs a payout reference, settles the reserved points and writes a ledger + audit entry", async () => {
    const missing = await update({ status: "PAID" });
    expect(missing.status).toBe(400);
    expect((await missing.json()).error).toBe("PAYOUT_REFERENCE_REQUIRED");

    const response = await update({ status: "PAID", providerTransactionId: "tr_123" });
    expect(response.status).toBe(200);
    expect(h.owTx.ownerWallet.updateMany.mock.calls[0][0].data).toEqual({ pendingPoints: { decrement: 300 } });
    expect(h.owTx.ownerLedger.create.mock.calls[0][0].data).toMatchObject({ type: "PAYOUT_SETTLED", providerTransactionId: "tr_123" });
    expect(h.owTx.auditLog.create).toHaveBeenCalled();
  });

  it("success: REJECTED returns the reserved points to the available balance", async () => {
    const response = await update({ status: "REJECTED", failureReason: "bad iban" });
    expect(response.status).toBe(200);
    expect(h.owTx.ownerWallet.updateMany.mock.calls[0][0].data).toEqual({ pendingPoints: { decrement: 300 }, availablePoints: { increment: 300 } });
    expect(h.owTx.ownerLedger.create.mock.calls[0][0].data.type).toBe("POINTS_RETURNED");
  });

  it("duplicate request: the same status again is a replay and moves no points", async () => {
    h.owTx.withdrawalRequest.findUnique.mockResolvedValue(pending({ status: "REJECTED" }));
    const response = await update({ status: "REJECTED" });
    expect((await response.json()).replayed).toBe(true);
    expect(h.owTx.ownerWallet.updateMany).not.toHaveBeenCalled();
  });

  it("failure: a finished withdrawal cannot be changed (409), an unknown one is 404", async () => {
    h.owTx.withdrawalRequest.findUnique.mockResolvedValue(pending({ status: "PAID" }));
    const response = await update({ status: "REJECTED" });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("WITHDRAWAL_ALREADY_FINAL");
    expect(h.owTx.ownerWallet.updateMany).not.toHaveBeenCalled();

    h.owTx.withdrawalRequest.findUnique.mockResolvedValue(null);
    expect((await update({ status: "PROCESSING" })).status).toBe(404);
  });

  it("failure: a reservation that no longer matches the wallet is 409 and nothing else is written", async () => {
    h.owTx.ownerWallet.updateMany.mockResolvedValue({ count: 0 });
    const response = await update({ status: "REJECTED" });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("OWNER_WALLET_RESERVATION_MISMATCH");
    expect(h.owTx.withdrawalRequest.update).not.toHaveBeenCalled();
  });

  it("empty data / invalid data: no body, an unknown status or an empty reference -> 400", async () => {
    for (const body of [{}, { status: "DONE" }, { status: "PAID", providerTransactionId: "" }, { status: "REJECTED", failureReason: "x".repeat(501) }, { status: 5 }]) {
      expect((await update(body)).status).toBe(400);
    }
    const bad = await withdrawalPatch(makeRequest(`/api/admin/withdrawals/${WD_ID}`, { method: "PATCH", rawBody: "{no" }), routeParams({ id: WD_ID }));
    expect(bad.status).toBe(400);
    expect(h.db.$transaction).not.toHaveBeenCalled();
  });

  it("database failure: outage -> 503; unexpected -> 500 INTERNAL_ERROR, recorded, with no internals", async () => {
    h.db.$transaction.mockRejectedValueOnce(dbDownError());
    expect((await update({ status: "PROCESSING" })).status).toBe(503);

    h.owTx.withdrawalRequest.update.mockRejectedValueOnce(new Error("deadlock on WithdrawalRequest"));
    const response = await update({ status: "PROCESSING" });
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(text).toContain("INTERNAL_ERROR");
    expect(text).not.toContain("deadlock");
    expect(h.logSystemError).toHaveBeenCalled();
  });
});

/* ================================================================== */
describe("POST /api/owner/withdraw", () => {
  let keySeq = 0;
  const key = () => `withdraw-key-${(keySeq += 1)}-pad`;
  const withdraw = (body: unknown, headers: Record<string, string> = {}) =>
    withdrawPost(makeRequest("/api/owner/withdraw", { body, headers }));

  beforeEach(() => {
    signInAs("SUPER_ADMIN");
    h.ow.wallet = { id: "ow1", ownerId: OWNER_ID, availablePoints: 1000, pendingPoints: 0 };
    h.db.$transaction.mockImplementation(h.serialized);
  });

  it("success: 201 reserves the points (available -> pending) and records ledger + audit", async () => {
    const response = await withdraw({ points: 300, idempotencyKey: key() });
    const json = await response.json();
    expect(response.status).toBe(201);
    expect(h.ow.wallet).toMatchObject({ availablePoints: 700, pendingPoints: 300 });
    expect(json).toMatchObject({ points: 300, status: "PENDING" });
    expect(Number(json.usdAmount)).toBe(pointsToUsd(300));
    expect(h.ow.ledger[0]).toMatchObject({ type: "POINTS_RESERVED", points: -300 });
    expect(h.ow.audits[0].action).toBe("OWNER_WITHDRAWAL_REQUESTED");
  });

  it("success: the key may also come from the Idempotency-Key header", async () => {
    const response = await withdraw({ points: 300 }, { "idempotency-key": key() });
    expect(response.status).toBe(201);
  });

  it("failure: disabled by configuration -> 503 and nothing is reserved", async () => {
    vi.stubEnv("OWNER_WITHDRAWAL_ENABLED", "false");
    const response = await withdraw({ points: 300, idempotencyKey: key() });
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("OWNER_WITHDRAWAL_DISABLED");
    expect(h.ow.wallet.availablePoints).toBe(1000);
  });

  it("insufficient balance: asking for more than is available -> 400 INSUFFICIENT_POINTS, nothing moves", async () => {
    const response = await withdraw({ points: 1001, idempotencyKey: key() });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("INSUFFICIENT_POINTS");
    expect(h.ow.wallet).toMatchObject({ availablePoints: 1000, pendingPoints: 0 });
    expect(h.ow.withdrawals.size).toBe(0);
  });

  it("empty data / invalid data: missing, tiny, negative, fractional or non-numeric points -> 400", async () => {
    for (const points of [undefined, 0, 1, 14, -300, 300.5, "abc", null, Number.NaN]) {
      const response = await withdraw({ points, idempotencyKey: key() });
      expect(response.status).toBe(400);
    }
    expect(h.ow.withdrawals.size).toBe(0);
  });

  it("invalid data: a missing or oversized idempotency key, or malformed JSON -> 400", async () => {
    expect((await withdraw({ points: 300 })).status).toBe(400);
    expect((await withdraw({ points: 300, idempotencyKey: "k".repeat(201) })).status).toBe(400);
    const bad = await withdrawPost(makeRequest("/api/owner/withdraw", { rawBody: "{no" }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("INVALID_JSON");
  });

  it("failure: an owner without a wallet -> 404 OWNER_WALLET_NOT_FOUND", async () => {
    h.ow.wallet = null;
    const response = await withdraw({ points: 300, idempotencyKey: key() });
    expect(response.status).toBe(404);
  });

  it("duplicate request: the same key and amount again is a 200 replay and reserves nothing more", async () => {
    const body = { points: 300, idempotencyKey: key() };
    await withdraw(body);
    const replay = await withdraw(body);
    expect(replay.status).toBe(200);
    expect(h.ow.wallet).toMatchObject({ availablePoints: 700, pendingPoints: 300 });
    expect(h.ow.withdrawals.size).toBe(1);
  });

  it("duplicate request: the same key with a different amount is a 400 conflict and changes nothing", async () => {
    const k = key();
    await withdraw({ points: 300, idempotencyKey: k });
    const response = await withdraw({ points: 600, idempotencyKey: k });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("IDEMPOTENCY_KEY_CONFLICT");
    expect(h.ow.wallet.pendingPoints).toBe(300);
  });

  it("concurrent request: five parallel copies of one request reserve the points exactly once", async () => {
    const body = { points: 300, idempotencyKey: key() };
    const responses = await Promise.all(Array.from({ length: 5 }, () => withdraw(body)));
    expect(responses.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(h.ow.wallet).toMatchObject({ availablePoints: 700, pendingPoints: 300 });
  });

  it("concurrent request: five parallel DIFFERENT withdrawals of 400 from 1000 -> two succeed, the rest are refused, never negative", async () => {
    const responses = await Promise.all(Array.from({ length: 5 }, () => withdraw({ points: 400, idempotencyKey: key() })));
    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(2);
    expect(statuses.filter((s) => s === 400)).toHaveLength(3);
    expect(h.ow.wallet).toMatchObject({ availablePoints: 200, pendingPoints: 800 });
  });

  it("concurrent request: losing a unique-key race (P2002) answers 409 IDEMPOTENCY_KEY_IN_PROGRESS", async () => {
    h.db.$transaction.mockRejectedValueOnce(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }));
    const response = await withdraw({ points: 300, idempotencyKey: key() });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("IDEMPOTENCY_KEY_IN_PROGRESS");
  });

  it("failure: a crash after the wallet was debited rolls the reservation back", async () => {
    h.owTx.auditLog.create.mockRejectedValueOnce(new Error("audit table locked"));
    const response = await withdraw({ points: 300, idempotencyKey: key() });
    expect(response.status).toBe(500);
    expect(h.ow.wallet).toMatchObject({ availablePoints: 1000, pendingPoints: 0 });
    expect(h.ow.withdrawals.size).toBe(0);
    expect(h.logSystemError).toHaveBeenCalledWith("owner:withdraw", expect.anything(), expect.objectContaining({ userId: OWNER_ID }));
  });

  it("database failure: outage -> 503 + Retry-After; unexpected -> 500 INTERNAL_ERROR with no internals", async () => {
    h.db.$transaction.mockRejectedValueOnce(dbDownError());
    const outage = await withdraw({ points: 300, idempotencyKey: key() });
    expect(outage.status).toBe(503);
    expect(outage.headers.get("Retry-After")).toBe("30");

    h.db.$transaction.mockRejectedValueOnce(new Error("relation OwnerWallet missing"));
    const broken = await withdraw({ points: 300, idempotencyKey: key() });
    const text = await broken.text();
    expect(broken.status).toBe(500);
    expect(text).toContain("INTERNAL_ERROR");
    expect(text).not.toContain("relation");
  });

  it("forbidden: a cross-site Origin is refused before the wallet is read", async () => {
    vi.stubEnv("APP_ORIGIN", "https://gamevortex.example");
    const response = await withdrawPost(makeRequest("/api/owner/withdraw", { body: { points: 300, idempotencyKey: key() }, headers: { origin: "https://evil.example" } }));
    expect(response.status).toBe(403);
    expect(h.ow.wallet.availablePoints).toBe(1000);
  });
});
