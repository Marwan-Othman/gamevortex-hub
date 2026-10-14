import { afterEach, describe, expect, it } from "vitest";
import { prepareLiveOrder } from "@/lib/trading/live-prepare";
import { executeApprovedLiveOrder } from "@/lib/trading/live-production-executor";

const originalLiveFlag = process.env.GAMEVORTEX_LIVE_TRADING_ENABLED;

afterEach(() => {
  if (originalLiveFlag === undefined) {
    delete process.env.GAMEVORTEX_LIVE_TRADING_ENABLED;
  } else {
    process.env.GAMEVORTEX_LIVE_TRADING_ENABLED = originalLiveFlag;
  }
  it("blocks execution of an existing approval until accounting is verified", async () => {
    await expect(
      executeApprovedLiveOrder({
        ownerId: "owner-test",
        approvalId: "approval-test",
        opportunityId: "opportunity-test",
        mode: "execute",
      }),
    ).rejects.toThrow("LIVE_TRADING_ACCOUNTING_NOT_READY");
  });

});

describe("live accounting readiness gate", () => {
  it("blocks live order preparation while production accounting is unverified", async () => {
    process.env.GAMEVORTEX_LIVE_TRADING_ENABLED = "true";

    await expect(
      prepareLiveOrder({
        ownerId: "owner-test",
        symbol: "BTCUSDT",
        amountUsd: 10,
        stopLossPercent: 1,
        takeProfitPercent: 2,
        ackOwnerSpot: true,
      }),
    ).rejects.toThrow("LIVE_TRADING_ACCOUNTING_NOT_READY");
  });

  it("does not reach the accounting gate while the live flag is disabled", async () => {
    process.env.GAMEVORTEX_LIVE_TRADING_ENABLED = "false";

    await expect(
      prepareLiveOrder({
        ownerId: "owner-test",
        symbol: "BTCUSDT",
        amountUsd: 10,
        stopLossPercent: 1,
        takeProfitPercent: 2,
        ackOwnerSpot: true,
      }),
    ).rejects.toThrow("GAMEVORTEX_LIVE_TRADING_DISABLED");
  });
});
