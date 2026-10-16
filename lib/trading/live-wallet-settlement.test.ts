import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  providerFills: vi.fn(),
  createAdapter: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  db: { $transaction: mocks.transaction },
}));
vi.mock("@/lib/trading/live-exchange", () => ({
  createLiveExchangeAdapter: mocks.createAdapter,
}));
vi.mock("@/lib/trading/live-fee-accounting", () => ({
  calculateLiveSpotNetExitProceeds: vi.fn(),
}));

import {
  calculateOwnerWalletSettlement,
  getExchangeProceedsTransferBlocker,
  getSettlementCurrencyBlocker,
  settleClosedLiveOrderToOwnerWallet,
} from "./live-wallet-settlement";

function closedPendingOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    ownerId: "owner-1",
    approvalId: "approval-1",
    opportunityId: "opportunity-1",
    idempotencyKey: "idempotency-1",
    clientOrderId: "client-1",
    providerOrderId: "provider-1",
    symbol: "BTCUSD",
    side: "BUY",
    amountUsd: new Prisma.Decimal("10"),
    entryPrice: new Prisma.Decimal("10"),
    stopLossPrice: new Prisma.Decimal("9"),
    takeProfitPrice: new Prisma.Decimal("11"),
    status: "CLOSED",
    protectionStatus: "PROTECTED",
    protectionOrderId: "protect-1",
    stopLossOrderId: "stop-1",
    takeProfitOrderId: "take-1",
    protectionUpdatedAt: new Date("2026-01-01T00:00:00Z"),
    protectionError: null,
    providerStatus: "CLOSED",
    executedQty: new Prisma.Decimal("1"),
    cumulativeQuoteQty: new Prisma.Decimal("10"),
    averageFillPrice: new Prisma.Decimal("10"),
    lastProviderUpdateAt: new Date("2026-01-01T00:00:00Z"),
    lastReconciledAt: new Date("2026-01-01T00:00:00Z"),
    lastError: null,
    version: 1,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    settlementStatus: "EXCHANGE_CLOSED_PENDING_WALLET",
    exitProviderOrderId: "exit-provider-1",
    exitExecutedQty: new Prisma.Decimal("1"),
    exitCumulativeQuoteQty: new Prisma.Decimal("11"),
    realizedPnlUsd: new Prisma.Decimal("1"),
    settledUsd: null,
    settledPoints: null,
    settlementRoundingUsd: null,
    ...overrides,
  };
}

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

  it("rejects negative exchange proceeds", () => {
    expect(() => calculateOwnerWalletSettlement(new Prisma.Decimal("-1"))).toThrow(
      "INVALID_SETTLEMENT_PROCEEDS",
    );
  });
});

describe("getExchangeProceedsTransferBlocker", () => {
  it("blocks wallet credit because exchange fills do not prove proceeds were transferred to GameVortex", () => {
    expect(getExchangeProceedsTransferBlocker()).toBe("EXCHANGE_PROCEEDS_TRANSFER_NOT_VERIFIED");
  });
});

describe("settleClosedLiveOrderToOwnerWallet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback({ $queryRaw: mocks.queryRaw }),
    );
  });

  it("blocks a closed order before querying exchange fills or crediting any wallet", async () => {
    const order = closedPendingOrder();
    const blockedOrder = {
      ...order,
      settlementStatus: "BLOCKED",
      settlementError: "EXCHANGE_PROCEEDS_TRANSFER_NOT_VERIFIED",
      version: 2,
    };
    mocks.queryRaw
      .mockResolvedValueOnce([order])
      .mockResolvedValueOnce([blockedOrder]);

    const tradeFillProvider = { getOrderTradeFills: mocks.providerFills };

    const result = await settleClosedLiveOrderToOwnerWallet({
      ownerId: "owner-1",
      order: order as never,
      tradeFillProvider,
    });

    expect(result.status).toBe("BLOCKED");
    expect(result.blockers).toEqual(["EXCHANGE_PROCEEDS_TRANSFER_NOT_VERIFIED"]);
    expect(result.settledUsd).toBeNull();
    expect(mocks.providerFills).not.toHaveBeenCalled();
    expect(mocks.createAdapter).not.toHaveBeenCalled();
    expect(mocks.queryRaw).toHaveBeenCalledTimes(2);
    expect(mocks.transaction).toHaveBeenCalledOnce();
  });

  it("fails closed when the database order is missing and never queries exchange fills", async () => {
    mocks.queryRaw.mockResolvedValueOnce([]);

    await expect(settleClosedLiveOrderToOwnerWallet({
      ownerId: "owner-1",
      order: closedPendingOrder() as never,
      tradeFillProvider: { getOrderTradeFills: mocks.providerFills },
    })).rejects.toThrow("LIVE_ORDER_NOT_FOUND_FOR_WALLET_SETTLEMENT");

    expect(mocks.providerFills).not.toHaveBeenCalled();
    expect(mocks.createAdapter).not.toHaveBeenCalled();
    expect(mocks.queryRaw).toHaveBeenCalledOnce();
  });

  it("preserves the original transfer blocker on a retry after settlement was blocked", async () => {
    const blockedOrder = closedPendingOrder({
      settlementStatus: "BLOCKED",
      settlementError: "EXCHANGE_PROCEEDS_TRANSFER_NOT_VERIFIED",
    });
    mocks.queryRaw.mockResolvedValueOnce([blockedOrder]);

    const result = await settleClosedLiveOrderToOwnerWallet({
      ownerId: "owner-1",
      order: closedPendingOrder() as never,
      tradeFillProvider: { getOrderTradeFills: mocks.providerFills },
    });

    expect(result.status).toBe("BLOCKED");
    expect(result.blockers).toEqual(["EXCHANGE_PROCEEDS_TRANSFER_NOT_VERIFIED"]);
    expect(mocks.providerFills).not.toHaveBeenCalled();
    expect(mocks.queryRaw).toHaveBeenCalledOnce();
  });

  it("does not block or mutate a settled order on idempotent retry", async () => {
    const settledOrder = closedPendingOrder({
      settlementStatus: "SETTLED",
      settledUsd: new Prisma.Decimal("11"),
      settledPoints: 0,
      settlementRoundingUsd: new Prisma.Decimal("0"),
    });
    mocks.queryRaw.mockResolvedValueOnce([settledOrder]);

    const result = await settleClosedLiveOrderToOwnerWallet({
      ownerId: "owner-1",
      order: settledOrder as never,
      tradeFillProvider: { getOrderTradeFills: mocks.providerFills },
    });

    expect(result.status).toBe("ALREADY_SETTLED");
    expect(result.settledUsd).toBe("11");
    expect(mocks.providerFills).not.toHaveBeenCalled();
    expect(mocks.queryRaw).toHaveBeenCalledOnce();
  });

  it("rejects an owner mismatch without calling the exchange provider", async () => {
    const order = closedPendingOrder();
    const blockedOrder = {
      ...order,
      settlementStatus: "BLOCKED",
      settlementError: "SETTLEMENT_OWNER_MISMATCH",
      version: 2,
    };
    mocks.queryRaw
      .mockResolvedValueOnce([order])
      .mockResolvedValueOnce([blockedOrder]);

    const result = await settleClosedLiveOrderToOwnerWallet({
      ownerId: "different-owner",
      order: order as never,
      tradeFillProvider: { getOrderTradeFills: mocks.providerFills },
    });

    expect(result.status).toBe("BLOCKED");
    expect(result.blockers).toEqual(["SETTLEMENT_OWNER_MISMATCH"]);
    expect(mocks.providerFills).not.toHaveBeenCalled();
  });
});

describe("getSettlementCurrencyBlocker", () => {
  it("allows only explicit USD quote proceeds", () => {
    expect(getSettlementCurrencyBlocker("USD")).toBeNull();
    expect(getSettlementCurrencyBlocker(" usd ")).toBeNull();
  });

  it("blocks USDT and USDC until verified USD conversion exists", () => {
    expect(getSettlementCurrencyBlocker("USDT")).toBe("SETTLEMENT_QUOTE_CURRENCY_REQUIRES_VERIFIED_USD_CONVERSION");
    expect(getSettlementCurrencyBlocker("USDC")).toBe("SETTLEMENT_QUOTE_CURRENCY_REQUIRES_VERIFIED_USD_CONVERSION");
  });

  it("rejects a missing quote asset", () => {
    expect(() => getSettlementCurrencyBlocker(" ")).toThrow("SETTLEMENT_EXIT_ASSET_INFO_REQUIRED");
  });
});
