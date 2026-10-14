import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  executeRaw: vi.fn(),
  auditCreate: vi.fn(),
  getAdapter: vi.fn(),
  buildOpportunity: vi.fn(),
  placeSpotBuy: vi.fn(),
  getAccountStatus: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  db: {
    $queryRaw: mocks.queryRaw,
    $executeRaw: mocks.executeRaw,
    auditLog: { create: mocks.auditCreate },
  },
}));

vi.mock("@/lib/trading/binance-spot-testnet-config", () => ({
  getBinanceSpotTestnetAdapter: mocks.getAdapter,
}));

vi.mock("@/lib/trading/opportunity-service", () => ({
  buildOwnerPaperOpportunityFromApproval: mocks.buildOpportunity,
}));

import { executeOwnerBinanceSpotTestnetBuy } from "@/lib/trading/testnet-execution";

const input = {
  ownerId: "owner-1",
  approvalId: "approval-1",
  opportunityId: "opportunity-1",
  strategy: {
    price: 100,
    previousPrice: 98,
    fastAverage: 99,
    slowAverage: 95,
    volume: 1000,
    averageVolume: 800,
    stopLossPercent: 2,
    takeProfitPercent: 4,
  },
  shariah: { symbol: "BTCUSDT" } as never,
};

const row = {
  id: "testnet-order-1",
  ownerId: input.ownerId,
  approvalId: input.approvalId,
  opportunityId: input.opportunityId,
  idempotencyKey: "testnet-approval-key",
  clientOrderId: "gv-testnet-client-order-1",
  providerOrderId: null,
  symbol: "BTCUSDT",
  amountUsd: new Prisma.Decimal(10),
  status: "INTENT_CREATED",
  lastError: null,
};

const plan = {
  preTrade: { allowed: true, reasons: [] },
  clientOrderId: "gv-testnet-client-order-1",
  symbol: "BTCUSDT",
  amountUsd: 10,
  entryPrice: 100,
  stopLossPrice: 98,
  takeProfitPrice: 104,
};

function setupAdapter() {
  mocks.getAccountStatus.mockResolvedValue({
    accountType: "SPOT",
    permissions: ["SPOT"],
    canTrade: true,
  });
  mocks.getAdapter.mockReturnValue({
    getAccountStatus: mocks.getAccountStatus,
    placeSpotBuy: mocks.placeSpotBuy,
  });
  mocks.buildOpportunity.mockResolvedValue({ executionPlan: plan });
}

function queueClaimedIntent() {
  mocks.queryRaw
    .mockResolvedValueOnce([row])
    .mockResolvedValueOnce([{ ...row, status: "SUBMITTING" }]);
}

describe("Binance Spot Testnet execution failure drills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAdapter();
    mocks.executeRaw.mockResolvedValue(1);
    mocks.auditCreate.mockResolvedValue({});
  });

  it("does not resubmit an approval after an ambiguous provider timeout", async () => {
    queueClaimedIntent();
    mocks.placeSpotBuy.mockRejectedValueOnce(new Error("provider timeout"));
    await expect(executeOwnerBinanceSpotTestnetBuy(input)).rejects.toThrow(
      "TESTNET_ORDER_OUTCOME_UNKNOWN",
    );
    expect(mocks.executeRaw).toHaveBeenCalledTimes(1);

    mocks.queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...row, status: "UNKNOWN" }])
      .mockResolvedValueOnce([]);
    await expect(executeOwnerBinanceSpotTestnetBuy(input)).rejects.toThrow(
      "TESTNET_ORDER_ALREADY_CLAIMED_OR_TERMINAL",
    );
    expect(mocks.placeSpotBuy).toHaveBeenCalledTimes(1);
  });

  it("persists a confirmed fill before recording an audit failure", async () => {
    queueClaimedIntent();
    mocks.queryRaw.mockResolvedValueOnce([
      { ...row, status: "FILLED", providerOrderId: "provider-order-9" },
    ]);
    mocks.placeSpotBuy.mockResolvedValueOnce({
      accepted: true,
      status: "FILLED",
      providerOrderId: "provider-order-9",
      clientOrderId: plan.clientOrderId,
    });
    mocks.auditCreate.mockRejectedValueOnce(new Error("database detail must not leak"));

    await expect(executeOwnerBinanceSpotTestnetBuy(input)).rejects.toThrow(
      "TESTNET_ORDER_AUDIT_WRITE_FAILED",
    );
    expect(mocks.placeSpotBuy).toHaveBeenCalledTimes(1);
    expect(mocks.executeRaw).toHaveBeenCalledTimes(1);
    expect(mocks.queryRaw).toHaveBeenCalledTimes(3);
  });

  it("fails closed when the durable claim compare-and-set loses a race", async () => {
    mocks.queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...row, status: "SUBMITTING" }])
      .mockResolvedValueOnce([]);

    await expect(executeOwnerBinanceSpotTestnetBuy(input)).rejects.toThrow(
      "TESTNET_ORDER_ALREADY_CLAIMED_OR_TERMINAL",
    );
    expect(mocks.placeSpotBuy).not.toHaveBeenCalled();
  });
});
