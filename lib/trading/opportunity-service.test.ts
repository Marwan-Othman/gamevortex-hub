import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const queryRaw = vi.fn();
const auditCreate = vi.fn();
const getRiskConfig = vi.fn();
const buildOwnerPaperOpportunity = vi.fn();

vi.mock("@/lib/prisma", () => ({
  db: {
    $queryRaw: queryRaw,
    auditLog: { create: auditCreate },
  },
}));

vi.mock("@/lib/trading/risk-config-service", () => ({
  getRiskConfig,
}));

vi.mock("@/lib/trading/opportunity-pipeline", () => ({
  buildOwnerPaperOpportunity,
}));

import {
  buildOwnerPaperOpportunityFromApproval,
  getConsumedOwnerApproval,
} from "./opportunity-service";

const approvalBase = {
  id: "approval-1",
  opportunityId: "opp-1",
  ownerId: "owner-1",
  amountUsd: new Prisma.Decimal("10"),
  issuedAt: new Date("2026-10-02T07:00:00.000Z"),
  expiresAt: new Date("2026-10-02T08:00:00.000Z"),
  consumedAt: new Date("2026-10-02T07:10:00.000Z"),
  status: "CONSUMED",
  strategyVersion: "v1",
  shariahStatus: "APPROVED",
  riskSnapshot: {
    requestedAmountUsd: 10,
    dailyLossUsd: 0,
    openTrades: 0,
    totalExposureUsd: 0,
    assetExposureUsd: 0,
    consecutiveLosses: 0,
    hasStopLoss: true,
    hasTakeProfit: true,
  },
};

describe("owner paper opportunity service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryRaw.mockResolvedValue([approvalBase]);
    auditCreate.mockResolvedValue({ id: "audit-1" });
    getRiskConfig.mockResolvedValue({
      enabled: true,
      config: {
        maxTradeAmountUsd: 100,
        maxDailyLossUsd: 20,
        maxOpenTrades: 2,
        maxExposureUsd: 100,
        maxExposurePerAssetUsd: 100,
        maxConsecutiveLosses: 3,
        requireStopLoss: true,
        requireTakeProfit: true,
      },
      updatedAt: new Date("2026-10-02T07:00:00.000Z"),
    });
    buildOwnerPaperOpportunity.mockReturnValue({
      proposal: { opportunityId: "opp-1" },
      executionPlan: { mode: "PAPER", clientOrderId: "gv-paper-test" },
    });
  });

  it("requires the exact owner, approval, and opportunity binding", async () => {
    queryRaw.mockResolvedValueOnce([]);

    await expect(
      getConsumedOwnerApproval({
        ownerId: "owner-1",
        approvalId: "approval-1",
        opportunityId: "opp-1",
      }),
    ).rejects.toThrow("APPROVAL_NOT_FOUND");
  });

  it("refuses an approval that has not been consumed", async () => {
    queryRaw.mockResolvedValueOnce([{ ...approvalBase, status: "PENDING", consumedAt: null }]);

    await expect(
      getConsumedOwnerApproval({
        ownerId: "owner-1",
        approvalId: "approval-1",
        opportunityId: "opp-1",
      }),
    ).rejects.toThrow("OWNER_APPROVAL_NOT_CONSUMED");
  });

  it("fails closed when the approval has no risk snapshot", async () => {
    queryRaw.mockResolvedValueOnce([{ ...approvalBase, riskSnapshot: null }]);

    await expect(
      buildOwnerPaperOpportunityFromApproval({
        ownerId: "owner-1",
        approvalId: "approval-1",
        opportunityId: "opp-1",
        strategy: {
          price: 110,
          previousPrice: 109,
          fastAverage: 108,
          slowAverage: 100,
          volume: 2000,
          averageVolume: 1500,
          stopLossPercent: 5,
          takeProfitPercent: 10,
        },
        shariah: {
          symbol: "ABC",
          assetType: "EQUITY",
          businessActivity: "software services",
          tradingMethod: "SPOT",
          ownershipSettlementVerified: true,
        },
      }),
    ).rejects.toThrow("APPROVAL_RISK_SNAPSHOT_REQUIRED");
  });

  it("rejects an approval whose stored risk amount does not match its amount", async () => {
    queryRaw.mockResolvedValueOnce([
      {
        ...approvalBase,
        riskSnapshot: { ...approvalBase.riskSnapshot, requestedAmountUsd: 20 },
      },
    ]);

    await expect(
      buildOwnerPaperOpportunityFromApproval({
        ownerId: "owner-1",
        approvalId: "approval-1",
        opportunityId: "opp-1",
        strategy: {
          price: 110,
          previousPrice: 109,
          fastAverage: 108,
          slowAverage: 100,
          volume: 2000,
          averageVolume: 1500,
          stopLossPercent: 5,
          takeProfitPercent: 10,
        },
        shariah: {
          symbol: "ABC",
          assetType: "EQUITY",
          businessActivity: "software services",
          tradingMethod: "SPOT",
          ownershipSettlementVerified: true,
        },
      }),
    ).rejects.toThrow("APPROVAL_AMOUNT_MISMATCH");
  });

  it("uses server-side risk configuration, deterministic idempotency, and audit logging", async () => {
    const result = await buildOwnerPaperOpportunityFromApproval({
      ownerId: "owner-1",
      approvalId: "approval-1",
      opportunityId: "opp-1",
      strategy: {
        price: 110,
        previousPrice: 109,
        fastAverage: 108,
        slowAverage: 100,
        volume: 2000,
        averageVolume: 1500,
        stopLossPercent: 5,
        takeProfitPercent: 10,
      },
      shariah: {
        symbol: "ABC",
        assetType: "EQUITY",
        businessActivity: "software services",
        tradingMethod: "SPOT",
        ownershipSettlementVerified: true,
      },
    });

    expect(result).toEqual({
      proposal: { opportunityId: "opp-1" },
      executionPlan: { mode: "PAPER", clientOrderId: "gv-paper-test" },
    });
    expect(getRiskConfig).toHaveBeenCalledWith("owner-1");
    expect(buildOwnerPaperOpportunity).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: "owner-1",
        opportunityId: "opp-1",
        amountUsd: 10,
        idempotencyKey: "paper-opportunity:approval-1",
        riskConfig: expect.any(Object),
        riskSnapshot: expect.objectContaining({ requestedAmountUsd: 10 }),
      }),
    );
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorUserId: "owner-1",
          action: "TRADING_PAPER_OPPORTUNITY_BUILT",
          entityType: "TradingApproval",
          entityId: "approval-1",
        }),
      }),
    );
  });
});
