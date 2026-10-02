import { describe, expect, it } from "vitest";
import { buildProtectedExitPlan } from "./protected-exit-plan";

describe("protected exit order planner", () => {
  it("builds a SELL OCO with take-profit above entry and stop-loss below entry", () => {
    const plan = buildProtectedExitPlan({
      symbol: "BTCUSDT",
      entryClientOrderId: "gv-live-entry-1",
      filledQuantity: "0.0015",
      entryPrice: "60000",
      takeProfitPrice: "62400",
      stopLossPrice: "58800",
      stopLimitPrice: "58650",
    });

    expect(plan).toEqual({
      contingencyType: "OCO",
      symbol: "BTCUSDT",
      side: "SELL",
      quantity: "0.0015",
      takeProfit: {
        clientOrderId: expect.stringMatching(/^gv-exit-tp-[a-f0-9]{20}$/),
        type: "LIMIT_MAKER",
        price: "62400",
      },
      stopLoss: {
        clientOrderId: expect.stringMatching(/^gv-exit-sl-[a-f0-9]{20}$/),
        type: "STOP_LOSS_LIMIT",
        price: "58650",
        stopPrice: "58800",
      },
    });
  });

  it("requires the take-profit to be above entry", () => {
    expect(() =>
      buildProtectedExitPlan({
        symbol: "BTCUSDT",
        entryClientOrderId: "entry-1",
        filledQuantity: 1,
        entryPrice: 100,
        takeProfitPrice: 99,
        stopLossPrice: 95,
        stopLimitPrice: 94,
      }),
    ).toThrow("INVALID_EXIT_TAKE_PROFIT_FOR_BUY");
  });

  it("requires the stop-loss and stop-limit ordering to be safe for a SELL exit", () => {
    expect(() =>
      buildProtectedExitPlan({
        symbol: "BTCUSDT",
        entryClientOrderId: "entry-1",
        filledQuantity: 1,
        entryPrice: 100,
        takeProfitPrice: 110,
        stopLossPrice: 95,
        stopLimitPrice: 96,
      }),
    ).toThrow("INVALID_EXIT_STOP_LIMIT_FOR_SELL");
  });

  it("rejects malformed or zero quantities", () => {
    expect(() =>
      buildProtectedExitPlan({
        symbol: "BTCUSDT",
        entryClientOrderId: "entry-1",
        filledQuantity: 0,
        entryPrice: 100,
        takeProfitPrice: 110,
        stopLossPrice: 95,
        stopLimitPrice: 94,
      }),
    ).toThrow("INVALID_EXIT_QUANTITY");
  });
});
