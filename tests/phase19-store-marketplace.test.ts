/**
 * Phase 19 - Store & Marketplace
 *
 * - GET  /api/marketplace/products          (public catalogue)
 * - POST /api/me/orders, GET /api/me/orders (order creation / history)
 * - POST /api/me/orders/[id]/wallet-checkout (paying with the wallet)
 * - GET  /api/me/orders/[id]/keys            (delivered keys)
 *
 * The wallet checkout runs against a small stateful fake of the database: transactions are
 * serialized and roll back when they throw, conditional updates behave like SQL. That makes the
 * double-spend, last-key and atomicity tests meaningful instead of just checking mock calls.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state: any = {};
  const clone = (s: any) => ({
    orders: new Map([...s.orders].map(([k, v]: any) => [k, { ...v }])),
    wallets: new Map([...s.wallets].map(([k, v]: any) => [k, { ...v }])),
    walletTx: new Map(s.walletTx),
    payments: [...s.payments],
    keys: s.keys.map((k: any) => ({ ...k })),
    entitlements: [...s.entitlements],
    ownerWallet: { ...s.ownerWallet },
    ownerLedger: new Map(s.ownerLedger),
    notifications: [...s.notifications],
    users: new Map([...s.users].map(([k, v]: any) => [k, { ...v }])),
    pointLedger: new Map(s.pointLedger),
  });
  let lock: Promise<unknown> = Promise.resolve();
  let counter = 0;

  const tx: any = {
    $queryRaw: vi.fn(async (sql: any) => {
      const text = (sql?.strings ?? []).join("?");
      if (text.includes('FROM "DigitalKey"')) {
        const [productId, limit] = sql.values;
        return state.keys.filter((k: any) => k.productId === productId && k.status === "AVAILABLE").slice(0, limit).map((k: any) => ({ id: k.id }));
      }
      return [];
    }),
    order: {
      findFirst: vi.fn(async ({ where }: any) => {
        const order = state.orders.get(where.id);
        return order && order.userId === where.userId ? order : null;
      }),
      update: vi.fn(async ({ where, data }: any) => Object.assign(state.orders.get(where.id), data)),
    },
    payment: {
      findFirst: vi.fn(async ({ where }: any) =>
        state.payments.find((p: any) => p.orderId === where.orderId && p.provider === where.provider && p.status === where.status) ?? null),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `pay_${(counter += 1)}`, createdAt: new Date(), ...data };
        state.payments.push(row);
        return row;
      }),
    },
    wallet: {
      findUnique: vi.fn(async ({ where }: any) => state.wallets.get(where.userId) ?? null),
      findUniqueOrThrow: vi.fn(async ({ where }: any) => [...state.wallets.values()].find((w: any) => w.id === where.id)),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const wallet = [...state.wallets.values()].find((w: any) => w.id === where.id);
        if (!wallet || !wallet.balance.gte(where.balance.gte)) return { count: 0 };
        wallet.balance = wallet.balance.sub(data.balance.decrement);
        return { count: 1 };
      }),
    },
    walletTransaction: {
      findUnique: vi.fn(async ({ where }: any) => state.walletTx.get(where.idempotencyKey) ?? null),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `wtx_${(counter += 1)}`, ...data };
        state.walletTx.set(data.idempotencyKey, row);
        return row;
      }),
    },
    digitalKey: {
      updateMany: vi.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const key of state.keys) {
          if (where.id.in.includes(key.id) && key.status === where.status) {
            Object.assign(key, data);
            count += 1;
          }
        }
        return { count };
      }),
      count: vi.fn(async ({ where }: any) => state.keys.filter((k: any) => k.productId === where.productId && k.status === where.status).length),
    },
    gameProduct: { update: vi.fn(async () => ({})) },
    entitlement: {
      findMany: vi.fn(async ({ where }: any) =>
        state.entitlements.filter((e: any) => e.userId === where.userId && where.gameId.in.includes(e.gameId) && e.revokedAt === null).map((e: any) => ({ gameId: e.gameId }))),
      upsert: vi.fn(async ({ create }: any) => {
        state.entitlements.push({ ...create, revokedAt: null });
        return create;
      }),
    },
    ownerWallet: {
      upsert: vi.fn(async () => state.ownerWallet),
      update: vi.fn(async ({ data }: any) => {
        if (data.availableUsd?.increment) state.ownerWallet.availableUsd = state.ownerWallet.availableUsd.add(data.availableUsd.increment);
        return state.ownerWallet;
      }),
    },
    ownerLedger: {
      findUnique: vi.fn(async ({ where }: any) => state.ownerLedger.get(where.idempotencyKey) ?? null),
      create: vi.fn(async ({ data }: any) => {
        state.ownerLedger.set(data.idempotencyKey, data);
        return data;
      }),
    },
    notification: {
      findFirst: vi.fn(async ({ where }: any) =>
        state.notifications.find((n: any) => n.userId === where.userId && n.metadata.idempotencyKey === where.metadata.equals) ?? null),
      create: vi.fn(async ({ data }: any) => {
        state.notifications.push(data);
        return data;
      }),
    },
    vipSubscription: { findFirst: vi.fn(async () => null) },
    user: {
      findFirst: vi.fn(async () => ({ id: "owner_1" })),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const user = state.users.get(where.id);
        if (!user) return { count: 0 };
        user.points += data.points.increment ?? 0;
        return { count: 1 };
      }),
      findUnique: vi.fn(async ({ where }: any) => state.users.get(where.id) ?? null),
    },
    pointLedger: {
      findUnique: vi.fn(async ({ where }: any) => state.pointLedger.get(where.idempotencyKey) ?? null),
      create: vi.fn(async ({ data }: any) => {
        state.pointLedger.set(data.idempotencyKey, data);
        return data;
      }),
    },
    orderItem: { findFirst: vi.fn(async () => null) },
  };

  const db: any = {
    order: { findUnique: vi.fn(), findMany: vi.fn() },
    gameProduct: { findMany: vi.fn() },
    $transaction: vi.fn(),
  };
  const serialized = async (work: (t: any) => Promise<unknown>) => {
    const run = lock.then(async () => {
      const before = clone(state);
      try {
        return await work(tx);
      } catch (error) {
        Object.assign(state, before); // rollback
        throw error;
      }
    });
    lock = run.catch(() => undefined);
    return run;
  };
  return {
    state,
    tx,
    db,
    serialized,
    requireUser: vi.fn(),
    logSystemError: vi.fn(),
    qualifyReferral: vi.fn(),
    decryptDigitalKey: vi.fn(),
  };
});

vi.mock("@/lib/prisma", () => ({ db: h.db, prisma: h.db }));
vi.mock("@/lib/auth", () => ({ requireUser: h.requireUser }));
vi.mock("@/lib/observability", () => ({ logSystemError: h.logSystemError }));
vi.mock("@/lib/referrals", () => ({ qualifyReferralOnFirstOrder: h.qualifyReferral }));
vi.mock("@/lib/digital-keys", () => ({ decryptDigitalKey: h.decryptDigitalKey }));

import { Prisma } from "@prisma/client";
import { GET as productsGet } from "@/app/api/marketplace/products/route";
import { GET as ordersGet, POST as ordersPost } from "@/app/api/me/orders/route";
import { POST as walletCheckoutPost } from "@/app/api/me/orders/[id]/wallet-checkout/route";
import { GET as keysGet } from "@/app/api/me/orders/[id]/keys/route";
import { dbDownError, makeRequest, nextIp, routeParams } from "./helpers/phase19";

const D = (v: string | number) => new Prisma.Decimal(v);
const U1 = { id: "user_buyer_1" };
const U2 = { id: "user_buyer_2" };

function product(id: string, gameId: string, priceCents = 1999, over: Record<string, unknown> = {}) {
  return {
    id,
    gameId,
    sku: `SKU-${id}`,
    kind: "GAME_KEY",
    deliveryType: "CODE",
    active: true,
    supplierVerified: true,
    priceCents,
    currency: "USD",
    rewardPoints: null,
    game: { published: true, sourceStatus: "VERIFIED" },
    ...over,
  };
}

function seedOrder(id: string, userId: string, productRow: any, over: Record<string, unknown> = {}) {
  const order = {
    id,
    userId,
    status: "PENDING",
    paymentStatus: "CREATED",
    totalCents: productRow.priceCents,
    currency: "USD",
    items: [{ id: `item_${id}`, productId: productRow.id, quantity: 1, unitPriceCents: productRow.priceCents, product: productRow }],
    ...over,
  };
  h.state.orders.set(id, order);
  h.state.keys.push({ id: `key_${id}`, productId: productRow.id, status: "AVAILABLE" });
  return order;
}

function seedWallet(userId: string, balance: string | number) {
  const wallet = { id: `wallet_${userId}`, userId, balance: D(balance) };
  h.state.wallets.set(userId, wallet);
  h.state.users.set(userId, { id: userId, points: 0 });
  return wallet;
}

beforeEach(() => {
  vi.stubEnv("APP_ORIGIN", "");
  vi.stubEnv("OWNER_PURCHASE_POINTS", "");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.clearAllMocks();
  Object.assign(h.state, {
    orders: new Map(),
    wallets: new Map(),
    walletTx: new Map(),
    payments: [],
    keys: [],
    entitlements: [],
    ownerWallet: { id: "owner_wallet_1", availableUsd: D(0) },
    ownerLedger: new Map(),
    notifications: [],
    users: new Map(),
    pointLedger: new Map(),
  });
  h.db.$transaction.mockReset();
  h.db.$transaction.mockImplementation(h.serialized);
  h.requireUser.mockReset();
  h.requireUser.mockResolvedValue(U1);
  h.qualifyReferral.mockReset();
  h.qualifyReferral.mockResolvedValue(undefined);
  h.logSystemError.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/* ================================================================== */
describe("GET /api/marketplace/products", () => {
  const list = (ip?: string) => productsGet(makeRequest("/api/marketplace/products", { ip }));
  const row = (over: Record<string, unknown> = {}) => ({
    id: "p1",
    sku: "SKU-1",
    title: "Game Key",
    description: "d",
    priceCents: 999,
    currency: "USD",
    kind: "GAME_KEY",
    deliveryType: "CODE",
    region: "GLOBAL",
    country: null,
    provider: "x",
    inventory: 5,
    supplierCost: 500,
    game: { id: "g1", slug: "g", titleAr: "ل", titleEn: "G", coverUrl: null, ratingAverage: 4 },
    digitalKeys: [{ id: "k1" }],
    ...over,
  });

  it("success: lists only sellable products, asks the database for verified+active+published ones, and is cacheable", async () => {
    h.db.gameProduct.findMany.mockResolvedValue([row()]);
    const response = await list();
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json).toHaveLength(1);
    expect(response.headers.get("Cache-Control")).toContain("s-maxage=60");

    const where = h.db.gameProduct.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ active: true, supplierVerified: true, kind: "GAME_KEY", deliveryType: "CODE", game: { published: true } });
  });

  it("success: never exposes key material, supplier cost or raw inventory", async () => {
    h.db.gameProduct.findMany.mockResolvedValue([row()]);
    const text = await (await list()).text();
    expect(text).not.toContain("digitalKeys");
    expect(text).not.toContain("ciphertext");
    expect(text).not.toContain("supplierCost");
    expect(text).not.toContain("inventory");
  });

  it("empty data: no products -> 200 and an empty array", async () => {
    h.db.gameProduct.findMany.mockResolvedValue([]);
    const response = await list();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it("empty data: a product with no stock and no available key is filtered out", async () => {
    h.db.gameProduct.findMany.mockResolvedValue([row({ inventory: 0, digitalKeys: [] }), row({ id: "p2", inventory: null, digitalKeys: [{ id: "k" }] })]);
    const json = await (await list()).json();
    expect(json.map((p: any) => p.id)).toEqual(["p2"]);
  });

  it("database failure: outage -> 503 + Retry-After; unexpected -> 500 PRODUCTS_LOAD_FAILED with no internals", async () => {
    h.db.gameProduct.findMany.mockRejectedValueOnce(dbDownError());
    const outage = await list();
    expect(outage.status).toBe(503);
    expect(outage.headers.get("Retry-After")).toBe("30");

    h.db.gameProduct.findMany.mockRejectedValueOnce(new Error('relation "GameProduct" does not exist'));
    const broken = await list();
    const text = await broken.text();
    expect(broken.status).toBe(500);
    expect(text).toContain("PRODUCTS_LOAD_FAILED");
    expect(text).not.toContain("relation");
  });

  it("failure: the 121st request in a minute from one IP is rate limited", async () => {
    h.db.gameProduct.findMany.mockResolvedValue([]);
    const ip = nextIp();
    let last: Response | undefined;
    for (let i = 0; i < 121; i += 1) last = await list(ip);
    expect(last?.status).toBe(429);
  });
});

/* ================================================================== */
describe("POST /api/me/orders (create order)", () => {
  const PID = "cmproduct00000000000000001";
  const KEY = "order-idem-key-0000001";
  const create = (body: unknown, ip?: string) => ordersPost(makeRequest("/api/me/orders", { body, ip }));
  const catalog = (over: Record<string, unknown> = {}) => ({
    ...product(PID, "game_1", 1000),
    inventory: 10,
    digitalKeys: [{ id: "k1" }, { id: "k2" }, { id: "k3" }],
    ...over,
  });

  // A transaction object that is enough for a paid (non-free) order.
  const orderTx = (over: Record<string, unknown> = {}) => ({
    $queryRaw: vi.fn(async () => []),
    entitlement: { findMany: vi.fn(async () => []), upsert: vi.fn() },
    orderItem: { findFirst: vi.fn(async () => null) },
    order: { create: vi.fn(async ({ data }: any) => ({ id: "order_new", ...data, items: data.items.create.map((i: any, n: number) => ({ id: `it${n}`, ...i })) })), update: vi.fn() },
    ...over,
  });

  beforeEach(() => {
    h.db.order.findUnique.mockResolvedValue(null);
    h.db.gameProduct.findMany.mockResolvedValue([catalog()]);
    h.db.$transaction.mockImplementation(async (work: any) => work(orderTx()));
  });

  it("success: 201; prices come from the database, never from the browser", async () => {
    const response = await create({ items: [{ productId: PID, quantity: 2, unitPriceCents: 1, priceCents: 1, totalCents: 1 }], idempotencyKey: KEY });
    const json = await response.json();
    expect(response.status).toBe(201);
    expect(json).toMatchObject({ subtotalCents: 2000, totalCents: 2000, currency: "USD", userId: U1.id });
    expect(json.items[0]).toMatchObject({ quantity: 2, unitPriceCents: 1000 });
  });

  it("success: duplicate lines for one product are merged into one quantity", async () => {
    const response = await create({ items: [{ productId: PID, quantity: 1 }, { productId: PID, quantity: 2 }], idempotencyKey: KEY });
    const json = await response.json();
    expect(json.items).toHaveLength(1);
    expect(json.items[0].quantity).toBe(3);
    expect(json.totalCents).toBe(3000);
  });

  it("unauthorized: not signed in -> 401 (not 400) and nothing is queried", async () => {
    h.requireUser.mockRejectedValue(new Error("UNAUTHORIZED"));
    const response = await create({ items: [{ productId: PID, quantity: 1 }], idempotencyKey: KEY });
    expect(response.status).toBe(401);
    expect(h.db.gameProduct.findMany).not.toHaveBeenCalled();
  });

  it("empty data: no items, an empty list or no body -> 400", async () => {
    for (const body of [{}, { items: [], idempotencyKey: KEY }, { items: [{ productId: PID, quantity: 1 }] }]) {
      const response = await create(body);
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe("INVALID_ORDER");
    }
    expect(h.db.gameProduct.findMany).not.toHaveBeenCalled();
  });

  it("invalid data: bad product id, quantity, idempotency key and oversized carts are refused", async () => {
    const line = { productId: PID, quantity: 1 };
    const bodies = [
      { items: [{ productId: "not a cuid!", quantity: 1 }], idempotencyKey: KEY },
      { items: [{ productId: PID, quantity: 0 }], idempotencyKey: KEY },
      { items: [{ productId: PID, quantity: 11 }], idempotencyKey: KEY },
      { items: [{ productId: PID, quantity: 1.5 }], idempotencyKey: KEY },
      { items: [{ productId: PID, quantity: "2" }], idempotencyKey: KEY },
      { items: [line], idempotencyKey: "short" },
      { items: [line], idempotencyKey: "k".repeat(101) },
      { items: Array.from({ length: 21 }, () => line), idempotencyKey: KEY },
    ];
    for (const body of bodies) expect((await create(body)).status).toBe(400);
    expect(h.db.$transaction).not.toHaveBeenCalled();
  });

  it("invalid data: merging lines that pass 10 copies is refused", async () => {
    const response = await create({ items: [{ productId: PID, quantity: 6 }, { productId: PID, quantity: 6 }], idempotencyKey: KEY });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("PRODUCT_QUANTITY_LIMIT_EXCEEDED");
  });

  it("invalid data: malformed JSON -> 400 INVALID_BODY", async () => {
    const response = await ordersPost(makeRequest("/api/me/orders", { rawBody: "{bad" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("INVALID_BODY");
  });

  it("duplicate request: the same key from the same user returns the existing order and creates nothing", async () => {
    h.db.order.findUnique.mockResolvedValue({ id: "order_old", userId: U1.id });
    const response = await create({ items: [{ productId: PID, quantity: 1 }], idempotencyKey: KEY });
    expect(response.status).toBe(200);
    expect((await response.json()).id).toBe("order_old");
    expect(h.db.$transaction).not.toHaveBeenCalled();
  });

  it("duplicate request: another user's key is a 409 conflict and reveals nothing about that order", async () => {
    h.db.order.findUnique.mockResolvedValue({ id: "order_secret", userId: "someone-else", totalCents: 123 });
    const response = await create({ items: [{ productId: PID, quantity: 1 }], idempotencyKey: KEY });
    const text = await response.text();
    expect(response.status).toBe(409);
    expect(text).not.toContain("order_secret");
  });

  it("concurrent request: losing a unique-key race -> 409 ORDER_ALREADY_EXISTS", async () => {
    h.db.$transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" }));
    const response = await create({ items: [{ productId: PID, quantity: 1 }], idempotencyKey: KEY });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("ORDER_ALREADY_EXISTS");
  });

  it("failure: unknown, withdrawn or unverified products -> 404 and no order", async () => {
    h.db.gameProduct.findMany.mockResolvedValue([]);
    const response = await create({ items: [{ productId: PID, quantity: 1 }], idempotencyKey: KEY });
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("PRODUCT_NOT_AVAILABLE_FOR_SALE");
    expect(h.db.$transaction).not.toHaveBeenCalled();
  });

  it("failure: out of stock (inventory or keys) -> 409", async () => {
    h.db.gameProduct.findMany.mockResolvedValue([catalog({ inventory: 1 })]);
    const byInventory = await create({ items: [{ productId: PID, quantity: 2 }], idempotencyKey: KEY });
    expect(byInventory.status).toBe(409);
    expect((await byInventory.json()).error).toContain("OUT_OF_STOCK");

    h.db.gameProduct.findMany.mockResolvedValue([catalog({ inventory: null, digitalKeys: [] })]);
    const byKeys = await create({ items: [{ productId: PID, quantity: 1 }], idempotencyKey: KEY });
    expect(byKeys.status).toBe(409);
    expect((await byKeys.json()).error).toContain("DIGITAL_KEYS_OUT_OF_STOCK");
  });

  it("failure: a game the user already owns -> 409 ALREADY_OWNED", async () => {
    h.db.$transaction.mockImplementation(async (work: any) =>
      work(orderTx({ entitlement: { findMany: vi.fn(async () => [{ gameId: "game_1" }]), upsert: vi.fn() } })),
    );
    const response = await create({ items: [{ productId: PID, quantity: 1 }], idempotencyKey: KEY });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("ALREADY_OWNED");
  });

  it("failure: products in different currencies cannot share one order", async () => {
    const other = "cmproduct00000000000000002";
    h.db.gameProduct.findMany.mockResolvedValue([catalog(), catalog({ id: other, currency: "EUR" })]);
    const response = await create({ items: [{ productId: PID, quantity: 1 }, { productId: other, quantity: 1 }], idempotencyKey: KEY });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("MIXED_CURRENCY_NOT_SUPPORTED");
  });

  it("free product: only one copy per order, and a second claim is refused", async () => {
    h.db.gameProduct.findMany.mockResolvedValue([catalog({ priceCents: 0 })]);
    const two = await create({ items: [{ productId: PID, quantity: 2 }], idempotencyKey: KEY });
    expect(two.status).toBe(400);
    expect((await two.json()).error).toBe("FREE_PRODUCT_QUANTITY_LIMIT");

    h.db.$transaction.mockImplementation(async (work: any) =>
      work(orderTx({ orderItem: { findFirst: vi.fn(async () => ({ id: "claimed" })) } })),
    );
    const again = await create({ items: [{ productId: PID, quantity: 1 }], idempotencyKey: KEY });
    expect(again.status).toBe(409);
    expect((await again.json()).error).toBe("FREE_PRODUCT_ALREADY_CLAIMED");
  });

  it("database failure: outage -> 503, unexpected -> 500 ORDER_FAILED + requestId, never the raw message", async () => {
    h.db.gameProduct.findMany.mockRejectedValueOnce(dbDownError());
    expect((await create({ items: [{ productId: PID, quantity: 1 }], idempotencyKey: KEY })).status).toBe(503);

    h.db.gameProduct.findMany.mockRejectedValueOnce(new Error("deadlock detected"));
    const response = await create({ items: [{ productId: PID, quantity: 1 }], idempotencyKey: KEY });
    const json = await response.json();
    expect(response.status).toBe(500);
    expect(json.error).toBe("ORDER_FAILED");
    expect(json.requestId).toBeDefined();
    expect(JSON.stringify(json)).not.toContain("deadlock");
  });

  it("failure: the 11th order request in a minute from one IP is rate limited", async () => {
    const ip = nextIp();
    let last: Response | undefined;
    for (let i = 0; i < 11; i += 1) last = await create({ items: [{ productId: PID, quantity: 1 }], idempotencyKey: `${KEY}${i}` }, ip);
    expect(last?.status).toBe(429);
  });
});

describe("GET /api/me/orders (order history)", () => {
  const list = () => ordersGet(makeRequest("/api/me/orders"));

  it("success: only the signed-in user's orders", async () => {
    h.db.order.findMany.mockResolvedValue([{ id: "o1" }]);
    const response = await list();
    expect(response.status).toBe(200);
    expect(h.db.order.findMany.mock.calls[0][0].where).toEqual({ userId: U1.id });
  });

  it("empty data: no orders -> []", async () => {
    h.db.order.findMany.mockResolvedValue([]);
    expect(await (await list()).json()).toEqual([]);
  });

  it("unauthorized: 401", async () => {
    h.requireUser.mockRejectedValue(new Error("UNAUTHORIZED"));
    expect((await list()).status).toBe(401);
  });

  it("database failure: 503, NOT 401 - an outage must not look like a logout", async () => {
    h.db.order.findMany.mockRejectedValue(dbDownError());
    const response = await list();
    expect(response.status).toBe(503);
  });

  it("database failure: an unexpected error is 500 ORDERS_LOAD_FAILED", async () => {
    h.db.order.findMany.mockRejectedValue(new Error("boom"));
    const response = await list();
    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe("ORDERS_LOAD_FAILED");
  });
});

/* ================================================================== */
describe("POST /api/me/orders/[id]/wallet-checkout", () => {
  const ORDER = "cmorder000000000000000001";
  const pay = (id = ORDER, ip?: string) => walletCheckoutPost(makeRequest(`/api/me/orders/${id}/wallet-checkout`, { method: "POST", ip }), routeParams({ id }));
  const balance = (userId = U1.id) => h.state.wallets.get(userId).balance.toString();
  const keyStatuses = () => h.state.keys.map((k: any) => k.status);

  let prod: ReturnType<typeof product>;
  beforeEach(() => {
    prod = product("prod_1", "game_1", 1999);
    seedOrder(ORDER, U1.id, prod);
    seedWallet(U1.id, "50");
  });

  it("success: charges once, delivers the key, grants access, credits the owner and the buyer's points", async () => {
    const response = await pay();
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(json).toMatchObject({ orderId: ORDER, alreadyPaid: false, balance: "30.01" });
    expect(balance()).toBe("30.01");

    const walletTx = h.state.walletTx.get(`wallet-purchase:${ORDER}`);
    expect(walletTx).toMatchObject({ type: "PURCHASE", referenceType: "ORDER", referenceId: ORDER, userId: U1.id });
    expect(walletTx.amount.toString()).toBe("-19.99");
    expect(walletTx.balanceBefore.toString()).toBe("50");
    expect(walletTx.balanceAfter.toString()).toBe("30.01");

    expect(keyStatuses()).toEqual(["DELIVERED"]);
    expect(h.state.entitlements).toHaveLength(1);
    expect(h.state.orders.get(ORDER)).toMatchObject({ status: "COMPLETED", paymentStatus: "SUCCEEDED", paymentProvider: "wallet" });
    expect(h.state.payments).toHaveLength(1);
    expect(h.state.ownerWallet.availableUsd.toString()).toBe("19.99");
    expect(h.state.users.get(U1.id).points).toBe(199);
    expect(h.state.notifications).toHaveLength(1);
    expect(h.qualifyReferral).toHaveBeenCalledWith(expect.anything(), U1.id);
  });

  it("success: paying exactly the wallet balance leaves zero", async () => {
    seedWallet(U1.id, "19.99");
    const response = await pay();
    expect(response.status).toBe(201);
    expect(balance()).toBe("0");
  });

  it("unauthorized: not signed in -> 401, nothing charged", async () => {
    h.requireUser.mockRejectedValue(new Error("UNAUTHORIZED"));
    const response = await pay();
    expect(response.status).toBe(401);
    expect(balance()).toBe("50");
  });

  it("forbidden: someone else's order answers 404, is not charged to the caller, and is not paid", async () => {
    h.requireUser.mockResolvedValue(U2);
    seedWallet(U2.id, "50");
    const response = await pay();
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("ORDER_NOT_FOUND");
    expect(balance(U2.id)).toBe("50");
    expect(h.state.orders.get(ORDER).status).toBe("PENDING");
  });

  it("invalid data: an unknown order id -> 404", async () => {
    const response = await pay("does-not-exist");
    expect(response.status).toBe(404);
  });

  it("insufficient balance: 402, no charge, no key, order stays payable", async () => {
    seedWallet(U1.id, "10");
    const response = await pay();
    expect(response.status).toBe(402);
    expect((await response.json()).error).toBe("INSUFFICIENT_WALLET_BALANCE");
    expect(balance()).toBe("10");
    expect(keyStatuses()).toEqual(["AVAILABLE"]);
    expect(h.state.walletTx.size).toBe(0);
    expect(h.state.orders.get(ORDER)).toMatchObject({ status: "PENDING", paymentStatus: "CREATED" });
  });

  it("insufficient balance: one cent short is still refused", async () => {
    seedWallet(U1.id, "19.98");
    expect((await pay()).status).toBe(402);
  });

  it("failure: a user without a wallet -> 400 WALLET_NOT_FOUND", async () => {
    h.state.wallets.delete(U1.id);
    const response = await pay();
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("WALLET_NOT_FOUND");
  });

  it("failure: orders that are not payable are 409", async () => {
    for (const patch of [{ status: "CANCELED" }, { paymentStatus: "FAILED" }, { totalCents: 0 }, { items: [] }]) {
      Object.assign(h.state.orders.get(ORDER), { status: "PENDING", paymentStatus: "CREATED", totalCents: 1999 }, patch);
      const response = await pay();
      expect(response.status).toBe(409);
      expect((await response.json()).error).toBe("ORDER_NOT_PAYABLE");
    }
    expect(balance()).toBe("50");
  });

  it("failure: only USD orders can use the wallet", async () => {
    h.state.orders.get(ORDER).currency = "EUR";
    const response = await pay();
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("WALLET_CURRENCY_NOT_SUPPORTED");
  });

  it("failure: a price that changed after the order was created is refused, not paid at the old price", async () => {
    prod.priceCents = 2999;
    const response = await pay();
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("ORDER_PRICE_CHANGED");
    expect(balance()).toBe("50");
  });

  it("failure: a product withdrawn after the order was created is refused", async () => {
    (prod as any).active = false;
    const response = await pay();
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("ORDER_ITEM_NOT_AVAILABLE_FOR_SALE");
  });

  it("failure: a game the buyer already owns is refused", async () => {
    h.state.entitlements.push({ userId: U1.id, gameId: "game_1", revokedAt: null });
    const response = await pay();
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("ALREADY_OWNED");
    expect(balance()).toBe("50");
  });

  it("failure: out of stock -> 409 and the wallet is restored (all-or-nothing)", async () => {
    h.state.keys.length = 0;
    const response = await pay();
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("OUT_OF_STOCK");
    expect(balance()).toBe("50");
    expect(h.state.walletTx.size).toBe(0);
    expect(h.state.payments).toHaveLength(0);
    expect(h.state.orders.get(ORDER).status).toBe("PENDING");
  });

  it("failure: a crash after the charge (here: the notification step) rolls EVERYTHING back", async () => {
    h.tx.notification.create.mockRejectedValueOnce(new Error("notifications table locked"));
    const response = await pay();
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(text).toContain("WALLET_CHECKOUT_FAILED");
    expect(text).not.toContain("locked");
    expect(balance()).toBe("50");
    expect(keyStatuses()).toEqual(["AVAILABLE"]);
    expect(h.state.entitlements).toHaveLength(0);
    expect(h.state.ownerWallet.availableUsd.toString()).toBe("0");
    expect(h.state.users.get(U1.id).points).toBe(0);
    expect(h.logSystemError).toHaveBeenCalledTimes(1);
  });

  it("duplicate request: paying twice charges once; the second answer is 200 alreadyPaid", async () => {
    const first = await pay();
    const second = await pay();
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect((await second.json()).alreadyPaid).toBe(true);
    expect(balance()).toBe("30.01");
    expect(h.state.walletTx.size).toBe(1);
    expect(h.state.payments).toHaveLength(1);
    expect(h.state.users.get(U1.id).points).toBe(199);
  });

  it("duplicate request: a replay is still 'already paid' even when the first payment emptied the wallet", async () => {
    seedWallet(U1.id, "19.99");
    await pay();
    const replay = await pay();
    expect(replay.status).toBe(200);
    expect((await replay.json()).alreadyPaid).toBe(true);
  });

  it("concurrent request: five simultaneous payments of one order -> one 201, four 'already paid', one charge, one key", async () => {
    const responses = await Promise.all(Array.from({ length: 5 }, () => pay()));
    const statuses = responses.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 200, 200, 200, 201]);
    expect(balance()).toBe("30.01");
    expect(h.state.walletTx.size).toBe(1);
    expect(keyStatuses()).toEqual(["DELIVERED"]);
    expect(h.state.ownerWallet.availableUsd.toString()).toBe("19.99");
  });

  it("concurrent request: two orders paid at the same time from a wallet that only covers one -> one 402, balance never negative", async () => {
    const ORDER_B = "cmorder000000000000000002";
    seedOrder(ORDER_B, U1.id, product("prod_2", "game_2", 1999));
    seedWallet(U1.id, "30");
    const responses = await Promise.all([pay(ORDER), pay(ORDER_B)]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 402]);
    expect(balance()).toBe("10.01");
  });

  it("concurrent request: two buyers racing for the LAST key -> one gets it, the other is refused untouched", async () => {
    const ORDER_B = "cmorder000000000000000003";
    seedWallet(U2.id, "50");
    seedOrder(ORDER_B, U2.id, prod);
    h.state.keys.pop(); // both orders were seeded with a key; only one key may exist
    h.requireUser.mockReset();
    h.requireUser.mockResolvedValueOnce(U1).mockResolvedValueOnce(U2);

    const responses = await Promise.all([pay(ORDER), pay(ORDER_B)]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(keyStatuses()).toEqual(["DELIVERED"]);
    const winner = responses[0].status === 201 ? U1.id : U2.id;
    const loser = winner === U1.id ? U2.id : U1.id;
    expect(balance(winner)).toBe("30.01");
    expect(balance(loser)).toBe("50");
  });

  it("database failure: an outage -> 503 + Retry-After, nothing charged", async () => {
    h.db.$transaction.mockRejectedValueOnce(dbDownError());
    const response = await pay();
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("30");
    expect(balance()).toBe("50");
  });

  it("forbidden: a cross-site Origin is refused before any money moves", async () => {
    vi.stubEnv("APP_ORIGIN", "https://gamevortex.example");
    const response = await walletCheckoutPost(
      makeRequest(`/api/me/orders/${ORDER}/wallet-checkout`, { method: "POST", headers: { origin: "https://evil.example" } }),
      routeParams({ id: ORDER }),
    );
    expect(response.status).toBe(403);
    expect(balance()).toBe("50");
  });

  it("failure: the 11th payment attempt in a minute from one IP is rate limited", async () => {
    const ip = nextIp();
    let last: Response | undefined;
    for (let i = 0; i < 11; i += 1) last = await pay("missing-order", ip);
    expect(last?.status).toBe(429);
  });
});

/* ================================================================== */
describe("GET /api/me/orders/[id]/keys", () => {
  const ORDER = "cmorder000000000000000009";
  const keys = (id = ORDER) => keysGet(makeRequest(`/api/me/orders/${id}/keys`), routeParams({ id }));

  beforeEach(() => {
    h.db.order.findFirst = vi.fn();
    h.db.order.findFirst.mockResolvedValue({
      id: ORDER,
      items: [{ id: "i1", product: { title: "G", sku: "S" }, digitalKeys: [{ id: "k1", ciphertext: "enc:abc", deliveredAt: new Date("2026-10-10T00:00:00Z") }] }],
    });
    h.decryptDigitalKey.mockReturnValue("AAAA-BBBB-CCCC");
  });

  it("success: returns the decrypted code, scoped to the owner and to PAID orders only, never cached", async () => {
    const response = await keys();
    const json = await response.json();
    expect(response.status).toBe(200);
    expect(json.items[0].keys[0].code).toBe("AAAA-BBBB-CCCC");
    expect(JSON.stringify(json)).not.toContain("enc:abc");
    expect(response.headers.get("Cache-Control")).toBe("no-store");

    const where = h.db.order.findFirst.mock.calls[0][0].where;
    expect(where.userId).toBe(U1.id);
    expect(where.OR).toEqual([{ paymentStatus: "SUCCEEDED" }, { paymentStatus: "NOT_REQUIRED", status: "COMPLETED" }]);
  });

  it("unauthorized: 401 and no query", async () => {
    h.requireUser.mockRejectedValue(new Error("UNAUTHORIZED"));
    expect((await keys()).status).toBe(401);
    expect(h.db.order.findFirst).not.toHaveBeenCalled();
  });

  it("forbidden: another user's order or an unpaid order -> 404 ORDER_NOT_FOUND", async () => {
    h.db.order.findFirst.mockResolvedValue(null);
    const response = await keys();
    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("ORDER_NOT_FOUND");
  });

  it("invalid data: an id that is not a valid cuid -> 400 and no query", async () => {
    const response = await keys("../../etc/passwd");
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("INVALID_ORDER_ID");
    expect(h.db.order.findFirst).not.toHaveBeenCalled();
  });

  it("empty data: a paid order whose items have no delivered keys yet returns empty key lists", async () => {
    h.db.order.findFirst.mockResolvedValue({ id: ORDER, items: [{ id: "i1", product: { title: "G", sku: "S" }, digitalKeys: [] }] });
    const json = await (await keys()).json();
    expect(json.items[0].keys).toEqual([]);
  });

  it("failure: a missing encryption secret -> 503 DELIVERY_NOT_CONFIGURED, no internals", async () => {
    h.decryptDigitalKey.mockImplementation(() => {
      throw new Error("DIGITAL_KEY_ENCRYPTION_SECRET_NOT_CONFIGURED");
    });
    const response = await keys();
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("DELIVERY_NOT_CONFIGURED");
  });

  it("failure: corrupt ciphertext -> 500 KEY_DELIVERY_FAILED without the cause", async () => {
    h.decryptDigitalKey.mockImplementation(() => {
      throw new Error("Unsupported state or unable to authenticate data");
    });
    const response = await keys();
    const text = await response.text();
    expect(response.status).toBe(500);
    expect(text).toContain("KEY_DELIVERY_FAILED");
    expect(text).not.toContain("authenticate");
  });

  it("database failure: outage -> 503", async () => {
    h.db.order.findFirst.mockRejectedValue(dbDownError());
    expect((await keys()).status).toBe(503);
  });
});
