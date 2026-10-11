import { afterEach, describe, expect, it } from "vitest";
import { prepareLiveOrder } from "./live-prepare";

const originalLiveFlag = process.env.GAMEVORTEX_LIVE_TRADING_ENABLED;

afterEach(() => {
  if (originalLiveFlag === undefined) {
    delete process.env.GAMEVORTEX_LIVE_TRADING_ENABLED;
  } else {
    process.env.GAMEVORTEX_LIVE_TRADING_ENABLED = originalLiveFlag;
  }
});

const validInput = {
  ownerId: "test-owner",
  symbol: "BTC/USDT",
  amountUsd: 10,
  stopLossPercent: 2,
  takeProfitPercent: 4,
  ackOwnerSpot: true,
};

describe("prepareLiveOrder accounting readiness gate", () => {
  it("refuses preparation while the live trading feature flag is disabled", async () => {
    process.env.GAMEVORTEX_LIVE_TRADING_ENABLED = "false";

    await expect(prepareLiveOrder(validInput)).rejects.toThrow("GAMEVORTEX_LIVE_TRADING_DISABLED");
  });

  it("refuses all new real-money approvals until accounting and reconciliation are verified", async () => {
    process.env.GAMEVORTEX_LIVE_TRADING_ENABLED = "true";

    await expect(prepareLiveOrder(validInput)).rejects.toThrow("LIVE_TRADING_ACCOUNTING_NOT_READY");
  });
});
