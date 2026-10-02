import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const requireTradingOwner = vi.fn();
const buildOwnerPaperOpportunityFromApproval = vi.fn();
const guardMutation = vi.fn();

vi.mock("@/lib/api", () => ({
  guardMutation,
}));

vi.mock("@/lib/trading/access", () => ({
  requireTradingOwner,
}));

vi.mock("@/lib/trading/opportunity-service", () => ({
  buildOwnerPaperOpportunityFromApproval,
}));

vi.mock("@/lib/trading/route-helpers", () => ({
  readJsonObject: async (request: NextRequest) => request.json(),
  tradingRouteError: async (error: unknown) =>
    new Response(JSON.stringify({ error: error instanceof Error ? error.message : "INTERNAL_ERROR" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    }),
}));

import { POST } from "./route";

describe("POST /api/admin/trading/opportunity", () => {
  it("stays closed when the mutation guard blocks the request", async () => {
    guardMutation.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "RATE_LIMITED" }), { status: 429 }),
    );

    const response = await POST(
      new NextRequest("http://localhost/api/admin/trading/opportunity", {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(429);
    expect(requireTradingOwner).not.toHaveBeenCalled();
  });

  it("passes only server-owned approval identity into the opportunity service", async () => {
    guardMutation.mockResolvedValueOnce(null);
    requireTradingOwner.mockResolvedValueOnce({ id: "owner-1", role: "SUPER_ADMIN" });
    buildOwnerPaperOpportunityFromApproval.mockResolvedValueOnce({
      proposal: { opportunityId: "opp-1" },
      executionPlan: { mode: "PAPER" },
    });

    const response = await POST(
      new NextRequest("http://localhost/api/admin/trading/opportunity", {
        method: "POST",
        body: JSON.stringify({
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
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(200);
    expect(buildOwnerPaperOpportunityFromApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: "owner-1",
        approvalId: "approval-1",
        opportunityId: "opp-1",
      }),
    );
  });

  it("rejects malformed strategy values before reaching the service", async () => {
    guardMutation.mockResolvedValueOnce(null);
    requireTradingOwner.mockResolvedValueOnce({ id: "owner-1", role: "SUPER_ADMIN" });

    const response = await POST(
      new NextRequest("http://localhost/api/admin/trading/opportunity", {
        method: "POST",
        body: JSON.stringify({
          approvalId: "approval-1",
          opportunityId: "opp-1",
          strategy: { price: 0 },
          shariah: {
            symbol: "ABC",
            assetType: "EQUITY",
            tradingMethod: "SPOT",
            ownershipSettlementVerified: true,
          },
        }),
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.status).toBe(500);
    expect(buildOwnerPaperOpportunityFromApproval).not.toHaveBeenCalled();
  });
});
