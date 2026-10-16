import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => {
  const money = (value: number) => ({ value, toString: () => value.toFixed(2), toNumber: () => value, valueOf: () => value, isZero: () => value === 0, equals: (other: any) => value === Number(other), sub: (other: any) => money(value - Number(other)) });
  const state: any = {
    owner: { id: "owner-1", role: "SUPER_ADMIN" },
    wallet: { id: "wallet-1", userId: "owner-1", balance: money(1), pendingBalance: money(0) },
    ownerWallet: null as any,
    transactions: new Map<string, any>(),
    nonUsdTransactions: 0,
    nonUsdCompletedDeposits: 0,
    hasLatestTransaction: true,
    ledgerMatchesBalance: true,
    ledgerTotalOverride: null as number | null,
    ledger: [] as any[],
    audits: [] as any[],
    failLedger: false,
    failAudit: false,
  };
  const tx: any = {
    walletTransaction: {
      findUnique: vi.fn(async ({ where }: any) => state.transactions.get(where.idempotencyKey) ?? null),
      count: vi.fn(async ({ where }: any) => where.currency?.not === "USD" ? h.state.nonUsdTransactions : 0),
      findFirst: vi.fn(async () => h.state.hasLatestTransaction && h.state.wallet ? { balanceAfter: h.state.wallet.balance, currency: "USD" } : null),
      aggregate: vi.fn(async () => ({ _sum: { amount: h.state.ledgerTotalOverride !== null ? h.money(h.state.ledgerTotalOverride) : h.state.ledgerMatchesBalance && h.state.wallet ? h.state.wallet.balance : h.money(0) } })),
      create: vi.fn(async ({ data }: any) => {
        if (state.transactions.has(data.idempotencyKey)) throw Object.assign(new Error("duplicate"), { code: "P2002" });
        const row = { id: "tx-1", ...data };
        state.transactions.set(data.idempotencyKey, row);
        return row;
      }),
    },
    walletDeposit: {
      count: vi.fn(async ({ where }: any) =>
        where.status === "COMPLETED" && where.currency?.not === "USD" ? h.state.nonUsdCompletedDeposits : 0),
    },
    wallet: {
      findUnique: vi.fn(async () => state.wallet ? { ...state.wallet } : null),
      findUniqueOrThrow: vi.fn(async () => ({ ...state.wallet })),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (!state.wallet || state.wallet.id !== where.id || Number(state.wallet.balance) < Number(where.balance.gte)) return { count: 0 };
        state.wallet.balance = money(Number(state.wallet.balance) - Number(data.balance.decrement));
        return { count: 1 };
      }),
    },
    ownerWallet: {
      findUnique: vi.fn(async () => state.ownerWallet ? { ...state.ownerWallet } : null),
      upsert: vi.fn(async ({ where, create }: any) => {
        if (!state.ownerWallet) state.ownerWallet = { id: "owner-wallet-1", ownerId: where.ownerId, availableUsd: money(0) };
        return { ...state.ownerWallet };
      }),
      findUniqueOrThrow: vi.fn(async () => ({ ...state.ownerWallet })),
      update: vi.fn(async ({ data }: any) => {
        state.ownerWallet.availableUsd = money(Number(state.ownerWallet.availableUsd) + Number(data.availableUsd.increment));
        return { ...state.ownerWallet };
      }),
    },
    ownerLedger: {
      create: vi.fn(async ({ data }: any) => {
        if (state.failLedger) throw new Error("ledger write failed");
        state.ledger.push(data);
        return data;
      }),
    },
    auditLog: {
      create: vi.fn(async ({ data }: any) => {
        if (state.failAudit) throw new Error("audit write failed");
        state.audits.push(data);
        return data;
      }),
    },
    $queryRaw: vi.fn(async () => []),
  };
  const db: any = {
    wallet: { findUnique: vi.fn(async () => state.wallet ? { balance: state.wallet.balance, pendingBalance: state.wallet.pendingBalance } : null) },
    ownerWallet: { findUnique: vi.fn(async () => state.ownerWallet ? { availableUsd: state.ownerWallet.availableUsd } : null) },
    walletTransaction: {
      count: vi.fn(async ({ where }: any) => where.currency?.not === "USD" ? h.state.nonUsdTransactions : 0),
      findFirst: vi.fn(async () => h.state.hasLatestTransaction && h.state.wallet ? { balanceAfter: h.state.wallet.balance, currency: "USD" } : null),
      aggregate: vi.fn(async () => ({ _sum: { amount: h.state.ledgerTotalOverride !== null ? h.money(h.state.ledgerTotalOverride) : h.state.ledgerMatchesBalance && h.state.wallet ? h.state.wallet.balance : h.money(0) } })),
    },
    walletDeposit: { count: vi.fn(async ({ where }: any) =>
      where.status === "COMPLETED" && where.currency?.not === "USD" ? h.state.nonUsdCompletedDeposits : 0) },
    $transaction: vi.fn(async (work: any) => {
      const snapshot = {
        wallet: state.wallet && { ...state.wallet },
        ownerWallet: state.ownerWallet && { ...state.ownerWallet },
        transactions: new Map(state.transactions),
        ledger: [...state.ledger],
        audits: [...state.audits],
      };
      try {
        return await work(tx);
      } catch (error) {
        state.wallet = snapshot.wallet;
        state.ownerWallet = snapshot.ownerWallet;
        state.transactions = snapshot.transactions;
        state.ledger = snapshot.ledger;
        state.audits = snapshot.audits;
        throw error;
      }
    }),
  };
  return { state, tx, db, money };
});

vi.mock("@/lib/prisma", () => ({ db: h.db }));
vi.mock("@/lib/trading/access", () => ({
  requireTradingOwner: vi.fn(async () => {
    if (!h.state.owner) throw new Error("UNAUTHORIZED");
    if (h.state.owner.role !== "SUPER_ADMIN") throw new Error("FORBIDDEN");
    return h.state.owner;
  }),
  tradingForbidden: () => Response.json({ error: "FORBIDDEN" }, { status: 403 }),
}));
vi.mock("@/lib/api", () => ({
  guardRead: vi.fn(async () => null),
  guardMutation: vi.fn(async () => null),
  internalError: vi.fn((_scope: string, _error: unknown, code: string) =>
    Response.json({ error: code }, { status: 500 })),
}));

import { GET, POST } from "@/app/api/admin/trading/wallet-funding/route";

function request(method: "GET" | "POST", body?: unknown, key?: string) {
  return new NextRequest("http://localhost/api/admin/trading/wallet-funding", {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(key ? { "idempotency-key": key } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  h.state.owner = { id: "owner-1", role: "SUPER_ADMIN" };
  h.state.wallet = { id: "wallet-1", userId: "owner-1", balance: h.money(1), pendingBalance: h.money(0) };
  h.state.ownerWallet = null;
  h.state.transactions = new Map();
  h.state.nonUsdTransactions = 0;
  h.state.nonUsdCompletedDeposits = 0;
  h.state.hasLatestTransaction = true;
  h.state.ledgerMatchesBalance = true;
  h.state.ledgerTotalOverride = null;
  h.state.ledger = [];
  h.state.audits = [];
  h.state.failLedger = false;
  h.state.failAudit = false;
  vi.clearAllMocks();
});

describe("trading wallet funding route", () => {
  it("returns balances and explicitly reports verified USD source currency without writing", async () => {
    const response = await GET(request("GET"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      sourceWalletAvailableUsd: "1.00",
      sourceWalletPendingUsd: "0.00",
      ownerWalletAvailableUsd: "0.00",
      sourceCurrencyVerified: true,
      sourceCurrencyBlocker: null,
    });
    expect(h.db.$transaction).not.toHaveBeenCalled();
  });

  it("marks source currency unverified in the balance response when non-USD history exists", async () => {
    h.state.nonUsdTransactions = 1;
    const response = await GET(request("GET"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      sourceCurrencyVerified: false,
      sourceCurrencyBlocker: "TRADING_FUNDING_SOURCE_CURRENCY_NOT_VERIFIED",
    });
    expect(h.db.$transaction).not.toHaveBeenCalled();
  });

  it("marks a nonzero legacy balance unverified when no USD ledger row reconciles it", async () => {
    h.state.ledgerMatchesBalance = false;
    const response = await GET(request("GET"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ sourceCurrencyVerified: false, sourceCurrencyBlocker: "TRADING_FUNDING_SOURCE_CURRENCY_NOT_VERIFIED" });
  });

  it("does not treat a zero wallet balance as reconciled when the USD ledger has a nonzero total", async () => {
    h.state.wallet.balance = h.money(0);
    h.state.ledgerTotalOverride = 1;
    const response = await GET(request("GET"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      sourceCurrencyVerified: false,
      sourceCurrencyBlocker: "TRADING_FUNDING_SOURCE_CURRENCY_NOT_VERIFIED",
    });
    const funding = await POST(request("POST", { amountUsd: 1 }, "funding-key-zero-mismatch"));
    expect(funding.status).toBe(409);
    expect((await funding.json()).error).toBe("TRADING_FUNDING_SOURCE_CURRENCY_NOT_VERIFIED");
    expect(Number(h.state.wallet.balance)).toBe(0);
    expect(h.state.ownerWallet).toBeNull();
  });

  it("refuses funding when a nonzero balance has no reconciled USD ledger row", async () => {
    h.state.ledgerMatchesBalance = false;
    const response = await POST(request("POST", { amountUsd: 1 }, "funding-key-unreconciled"));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("TRADING_FUNDING_SOURCE_CURRENCY_NOT_VERIFIED");
    expect(Number(h.state.wallet.balance)).toBe(1);
    expect(h.state.ownerWallet).toBeNull();
  });

  it("blocks a latest USD ledger row when the complete USD ledger total does not reconcile", async () => {
    // Simulate a misleading latest row: the full historical ledger is still short of the wallet balance.
    h.state.ledgerMatchesBalance = false;
    const response = await GET(request("GET"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      sourceCurrencyVerified: false,
      sourceCurrencyBlocker: "TRADING_FUNDING_SOURCE_CURRENCY_NOT_VERIFIED",
    });
    const funding = await POST(request("POST", { amountUsd: 1 }, "funding-key-ledger-total"));
    expect(funding.status).toBe(409);
    expect((await funding.json()).error).toBe("TRADING_FUNDING_SOURCE_CURRENCY_NOT_VERIFIED");
    expect(Number(h.state.wallet.balance)).toBe(1);
    expect(h.state.ownerWallet).toBeNull();
  });

  it("refuses non-owner access", async () => {
    h.state.owner = { id: "staff-1", role: "STAFF" };
    const response = await POST(request("POST", { amountUsd: 1 }, "funding-key-001"));
    expect(response.status).toBe(403);
    expect(Number(h.state.wallet.balance)).toBe(1);
  });

  it.each([0, -1, 1.5, 1001, "1", null])("rejects invalid amount %s", async (amountUsd) => {
    const response = await POST(request("POST", { amountUsd }, "funding-key-001"));
    expect(response.status).toBe(400);
    expect(Number(h.state.wallet.balance)).toBe(1);
  });

  it("requires an idempotency key", async () => {
    const response = await POST(request("POST", { amountUsd: 1 }));
    expect(response.status).toBe(400);
  });

  it("moves funds atomically and records both ledgers and audit", async () => {
    const response = await POST(request("POST", { amountUsd: 1 }, "funding-key-001"));
    expect(response.status).toBe(201);
    expect(Number(h.state.wallet.balance)).toBe(0);
    expect(Number(h.state.ownerWallet.availableUsd)).toBe(1);
    expect(h.state.transactions.size).toBe(1);
    expect(h.state.ledger).toHaveLength(1);
    expect(h.state.audits).toHaveLength(1);
  });

  it("blocks funding when source wallet history includes unconverted non-USD currency", async () => {
    h.state.nonUsdTransactions = 1;
    const response = await POST(request("POST", { amountUsd: 1 }, "funding-key-foreign"));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("TRADING_FUNDING_SOURCE_CURRENCY_NOT_VERIFIED");
    expect(Number(h.state.wallet.balance)).toBe(1);
    expect(h.state.ownerWallet).toBeNull();
    expect(h.state.transactions.size).toBe(0);
  });

  it("blocks funding when completed deposit history contains non-USD currency even if transaction history does not", async () => {
    h.state.nonUsdCompletedDeposits = 1;
    const response = await POST(request("POST", { amountUsd: 1 }, "funding-key-foreign-deposit"));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("TRADING_FUNDING_SOURCE_CURRENCY_NOT_VERIFIED");
    expect(Number(h.state.wallet.balance)).toBe(1);
    expect(h.state.ownerWallet).toBeNull();
    expect(h.state.transactions.size).toBe(0);
  });

  it("refuses insufficient available balance without touching owner wallet", async () => {
    const response = await POST(request("POST", { amountUsd: 5 }, "funding-key-001"));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("INSUFFICIENT_WALLET_BALANCE");
    expect(Number(h.state.wallet.balance)).toBe(1);
    expect(h.state.ownerWallet).toBeNull();
    expect(h.state.transactions.size).toBe(0);
  });

  it("rolls back the debit and credit if ledger persistence fails", async () => {
    h.state.failLedger = true;
    const response = await POST(request("POST", { amountUsd: 1 }, "funding-key-001"));
    expect(response.status).toBe(500);
    expect(Number(h.state.wallet.balance)).toBe(1);
    expect(h.state.ownerWallet).toBeNull();
    expect(h.state.transactions.size).toBe(0);
    expect(h.state.ledger).toHaveLength(0);
    expect(h.state.audits).toHaveLength(0);
  });

  it("rolls back all writes if audit persistence fails", async () => {
    h.state.failAudit = true;
    const response = await POST(request("POST", { amountUsd: 1 }, "funding-key-001"));
    expect(response.status).toBe(500);
    expect(Number(h.state.wallet.balance)).toBe(1);
    expect(h.state.ownerWallet).toBeNull();
    expect(h.state.transactions.size).toBe(0);
    expect(h.state.ledger).toHaveLength(0);
    expect(h.state.audits).toHaveLength(0);
  });

  it("returns current balances on an idempotent replay without debiting twice", async () => {
    const first = await POST(request("POST", { amountUsd: 1 }, "funding-key-001"));
    expect(first.status).toBe(201);
    const replay = await POST(request("POST", { amountUsd: 1 }, "funding-key-001"));
    expect(replay.status).toBe(200);
    expect((await replay.json()).replayed).toBe(true);
    expect(Number(h.state.wallet.balance)).toBe(0);
    expect(Number(h.state.ownerWallet.availableUsd)).toBe(1);
    expect(h.state.transactions.size).toBe(1);
    expect(h.state.ledger).toHaveLength(1);
  });

  it("rejects reuse of a key for a different amount", async () => {
    await POST(request("POST", { amountUsd: 1 }, "funding-key-001"));
    const response = await POST(request("POST", { amountUsd: 5 }, "funding-key-001"));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("IDEMPOTENCY_KEY_CONFLICT");
    expect(Number(h.state.wallet.balance)).toBe(0);
    expect(Number(h.state.ownerWallet.availableUsd)).toBe(1);
  });

  it("does not expose database error details to the client", async () => {
    h.db.$transaction.mockRejectedValueOnce(new Error("relation OwnerWallet missing"));
    const response = await POST(request("POST", { amountUsd: 1 }, "funding-key-002"));
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).not.toContain("relation OwnerWallet missing");
  });
});
