import { describe, expect, it } from "vitest";
import {
  closePaperPosition,
  evaluatePaperPositionExit,
  openPaperPosition,
} from "./position";

function position(overrides: Record<string, unknown> = {}) {
  return openPaperPosition({
    positionId: "position-1",
    symbol: "TEST",
    amountUsd: 10,
    entryPrice: 100,
    stopLossPrice: 95,
    takeProfitPrice: 110,
    openedAt: "2026-10-01T20:00:00Z",
    shariahPolicyVersion: "strict-v1",
    ...overrides,
  });
}

describe("paper position lifecycle", () => {
  it("opens only a valid spot BUY position", () => {
    const result = position();

    expect(result.status).toBe("OPEN");
    expect(result.side).toBe("BUY");
    expect(result.symbol).toBe("TEST");
    expect(result.amountUsd).toBe(10);
    expect(result.stopLossPrice).toBe(95);
    expect(result.takeProfitPrice).toBe(110);
    expect(result.shariahPolicyVersion).toBe("strict-v1");
  });

  it("rejects positions below the $1 minimum", () => {
    expect(() => position({ amountUsd: 0.99 })).toThrow("INVALID_POSITION_AMOUNT");
  });

  it("requires the stop-loss to be below the BUY entry", () => {
    expect(() => position({ stopLossPrice: 100 })).toThrow(
      "INVALID_POSITION_STOP_LOSS_FOR_BUY",
    );
  });

  it("requires the take-profit to be above the BUY entry", () => {
    expect(() => position({ takeProfitPrice: 100 })).toThrow(
      "INVALID_POSITION_TAKE_PROFIT_FOR_BUY",
    );
  });

  it("requires a Shariah policy version", () => {
    expect(() => position({ shariahPolicyVersion: "" })).toThrow(
      "INVALID_POSITION_SHARIAH_POLICY_VERSION",
    );
  });

  it("rejects malformed identity and timestamp inputs", () => {
    expect(() => position({ positionId: "" })).toThrow("INVALID_POSITION_ID");
    expect(() => position({ symbol: "   " })).toThrow("INVALID_POSITION_SYMBOL");
    expect(() => position({ openedAt: "not-a-date" })).toThrow("INVALID_POSITION_OPEN_TIME");
  });

  it("detects take-profit and stop-loss exits", () => {
    const result = evaluatePaperPositionExit(position(), 120);
    expect(result).toEqual({ reason: "TAKE_PROFIT", price: 110 });

    const stop = evaluatePaperPositionExit(position(), 90);
    expect(stop).toEqual({ reason: "STOP_LOSS", price: 95 });
  });

  it("does not create an exit while price remains between the guards", () => {
    expect(evaluatePaperPositionExit(position(), 100)).toBeNull();
    expect(evaluatePaperPositionExit(position(), 105)).toBeNull();
  });

  it("closes a position and calculates deterministic P&L", () => {
    const result = closePaperPosition(position(), {
      exitPrice: 110,
      reason: "TAKE_PROFIT",
      closedAt: "2026-10-01T20:05:00Z",
    });

    expect(result.status).toBe("CLOSED");
    expect(result.exitPrice).toBe(110);
    expect(result.exitReason).toBe("TAKE_PROFIT");
    expect(result.pnlUsd).toBeCloseTo(1);
    expect(result.returnPercent).toBeCloseTo(10);
    expect(result.shariahPolicyVersion).toBe("strict-v1");
  });

  it("rejects closing an already closed position", () => {
    const closed = closePaperPosition(position(), {
      exitPrice: 110,
      reason: "TAKE_PROFIT",
      closedAt: "2026-10-01T20:05:00Z",
    });

    expect(() =>
      closePaperPosition(closed, {
        exitPrice: 111,
        reason: "MANUAL",
        closedAt: "2026-10-01T20:06:00Z",
      }),
    ).toThrow("POSITION_ALREADY_CLOSED");
  });

  it("rejects a close time before the open time", () => {
    expect(() =>
      closePaperPosition(position(), {
        exitPrice: 101,
        reason: "MANUAL",
        closedAt: "2026-09-30T20:00:00Z",
      }),
    ).toThrow("INVALID_POSITION_CLOSE_TIME");
  });
});
