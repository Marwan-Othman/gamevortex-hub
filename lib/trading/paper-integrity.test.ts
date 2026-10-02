import { describe, expect, it } from "vitest";
import { openPaperPosition, evaluatePaperPositionExit, closePaperPosition } from "./position";
import { reconcilePaperExecution, type PaperReconciliation } from "./reconciliation";
import { settleClosedPaperPosition } from "./settlement";
import type { PaperExecutionRecord } from "./paper-execution-bridge";

const baseInput = {
  positionId: "pos-test-001",
  symbol: "BTCUSD",
  amountUsd: 10,
  entryPrice: 100,
  stopLossPrice: 98,
  takeProfitPrice: 104,
  openedAt: "2026-10-02T06:00:00.000Z",
  shariahPolicyVersion: "2026-10-01",
};

describe("paper trading integrity", () => {
  it("enforces the $1 minimum position amount", () => {
    expect(() => openPaperPosition({ ...baseInput, amountUsd: 0.99 })).toThrow(
      "INVALID_POSITION_AMOUNT",
    );
  });

  it("normalizes symbols before storing a paper position", () => {
    const position = openPaperPosition({ ...baseInput, symbol: "  btcusd  " });
    expect(position.symbol).toBe("BTCUSD");
  });

  it("rejects a BUY position whose stop-loss is not below entry", () => {
    expect(() => openPaperPosition({ ...baseInput, stopLossPrice: 100 })).toThrow(
      "INVALID_POSITION_STOP_LOSS_FOR_BUY",
    );
  });

  it("rejects a BUY position whose take-profit is not above entry", () => {
    expect(() => openPaperPosition({ ...baseInput, takeProfitPrice: 100 })).toThrow(
      "INVALID_POSITION_TAKE_PROFIT_FOR_BUY",
    );
  });

  it("prioritizes stop-loss when both exit levels are touched", () => {
    const position = openPaperPosition(baseInput);
    expect(evaluatePaperPositionExit(position, 98)).toEqual({
      reason: "STOP_LOSS",
      price: 98,
    });
  });

  it("returns no exit while an open position remains between its guards", () => {
    const position = openPaperPosition(baseInput);
    expect(evaluatePaperPositionExit(position, 101)).toBeUndefined();
  });

  it("computes deterministic BUY P&L when a position closes", () => {
    const position = openPaperPosition(baseInput);
    const closed = closePaperPosition(position, {
      exitPrice: 104,
      reason: "TAKE_PROFIT",
      closedAt: "2026-10-02T07:00:00.000Z",
    });

    expect(closed.pnlUsd).toBeCloseTo(0.4, 10);
    expect(closed.returnPercent).toBeCloseTo(4, 10);
  });

  it("rejects a stop-loss close whose price was not the configured stop-loss", () => {
    const position = openPaperPosition(baseInput);
    expect(() =>
      closePaperPosition(position, {
        exitPrice: 97,
        reason: "STOP_LOSS",
        closedAt: "2026-10-02T07:00:00.000Z",
      }),
    ).toThrow("STOP_LOSS_EXIT_PRICE_MISMATCH");
  });

  it("rejects a take-profit close whose price was not the configured take-profit", () => {
    const position = openPaperPosition(baseInput);
    expect(() =>
      closePaperPosition(position, {
        exitPrice: 103,
        reason: "TAKE_PROFIT",
        closedAt: "2026-10-02T07:00:00.000Z",
      }),
    ).toThrow("TAKE_PROFIT_EXIT_PRICE_MISMATCH");
  });

  it("rejects a take-profit reason when no take-profit guard exists", () => {
    const position = openPaperPosition({ ...baseInput, takeProfitPrice: undefined });
    expect(() =>
      closePaperPosition(position, {
        exitPrice: 104,
        reason: "TAKE_PROFIT",
        closedAt: "2026-10-02T07:00:00.000Z",
      }),
    ).toThrow("TAKE_PROFIT_NOT_CONFIGURED");
  });

  it("rejects a close timestamp earlier than the open timestamp", () => {
    const position = openPaperPosition(baseInput);
    expect(() =>
      closePaperPosition(position, {
        exitPrice: 104,
        reason: "TAKE_PROFIT",
        closedAt: "2026-10-02T05:59:59.000Z",
      }),
    ).toThrow("INVALID_POSITION_CLOSE_TIME");
  });

  it("settles a closed paper position without changing the simulated accounting result", () => {
    const position = closePaperPosition(openPaperPosition(baseInput), {
      exitPrice: 104,
      reason: "TAKE_PROFIT",
      closedAt: "2026-10-02T07:00:00.000Z",
    });

    const settlement = settleClosedPaperPosition(position);
    expect(settlement.status).toBe("SETTLED");
    expect(settlement.settlementValueUsd).toBeCloseTo(10.4, 10);
    expect(settlement.pnlUsd).toBeCloseTo(0.4, 10);
    expect(settlement.returnPercent).toBeCloseTo(4, 10);
    expect(settlement.shariahPolicyVersion).toBe(baseInput.shariahPolicyVersion);
  });

  it("rejects settlement when stored P&L drifts from the price-derived P&L", () => {
    const position = closePaperPosition(openPaperPosition(baseInput), {
      exitPrice: 104,
      reason: "TAKE_PROFIT",
      closedAt: "2026-10-02T07:00:00.000Z",
    });

    expect(() =>
      settleClosedPaperPosition({
        ...position,
        pnlUsd: 0.5,
      }),
    ).toThrow("PAPER_SETTLEMENT_PNL_DRIFT");
  });

  it("rejects settlement when stored return percentage drifts from the price-derived return", () => {
    const position = closePaperPosition(openPaperPosition(baseInput), {
      exitPrice: 104,
      reason: "TAKE_PROFIT",
      closedAt: "2026-10-02T07:00:00.000Z",
    });

    expect(() =>
      settleClosedPaperPosition({
        ...position,
        returnPercent: 5,
      }),
    ).toThrow("PAPER_SETTLEMENT_RETURN_DRIFT");
  });

  it("rejects non-positive settlement inputs", () => {
    const position = closePaperPosition(openPaperPosition(baseInput), {
      exitPrice: 104,
      reason: "TAKE_PROFIT",
      closedAt: "2026-10-02T07:00:00.000Z",
    });

    expect(() =>
      settleClosedPaperPosition({
        ...position,
        exitPrice: 0,
      }),
    ).toThrow("INVALID_PAPER_SETTLEMENT_PRICES");
  });

  it("reconciles an execution and position when all immutable fields match", () => {
    const position = openPaperPosition(baseInput);
    const execution: PaperExecutionRecord = {
      positionId: position.positionId,
      clientOrderId: "client-test-001",
      symbol: position.symbol,
      amountUsd: position.amountUsd,
      entryPrice: position.entryPrice,
      stopLossPrice: position.stopLossPrice,
      takeProfitPrice: position.takeProfitPrice,
      shariahPolicyVersion: position.shariahPolicyVersion,
    };

    const result = reconcilePaperExecution(execution, position);
    expect(result).toEqual<PaperReconciliation>({
      status: "MATCHED",
      positionId: position.positionId,
      clientOrderId: execution.clientOrderId,
    });
  });

  it("surfaces reconciliation mismatches instead of silently accepting them", () => {
    const position = openPaperPosition(baseInput);
    const execution: PaperExecutionRecord = {
      positionId: position.positionId,
      clientOrderId: "client-test-002",
      symbol: position.symbol,
      amountUsd: position.amountUsd + 1,
      entryPrice: position.entryPrice,
      stopLossPrice: position.stopLossPrice,
      takeProfitPrice: position.takeProfitPrice,
      shariahPolicyVersion: position.shariahPolicyVersion,
    };

    const result = reconcilePaperExecution(execution, position);
    expect(result.status).toBe("MISMATCHED");
    if (result.status === "MISMATCHED") {
      expect(result.reasons).toContain("AMOUNT_MISMATCH");
    }
  });

  it("fails closed when an execution contains malformed numeric or identity fields", () => {
    const position = openPaperPosition(baseInput);
    const execution: PaperExecutionRecord = {
      positionId: "",
      clientOrderId: " ",
      symbol: position.symbol,
      amountUsd: Number.NaN,
      entryPrice: Number.POSITIVE_INFINITY,
      stopLossPrice: 0,
      takeProfitPrice: position.takeProfitPrice,
      shariahPolicyVersion: position.shariahPolicyVersion,
    };

    const result = reconcilePaperExecution(execution, position);
    expect(result.status).toBe("MISMATCHED");
    if (result.status === "MISMATCHED") {
      expect(result.reasons).toEqual(
        expect.arrayContaining([
          "INVALID_CLIENT_ORDER_ID",
          "INVALID_EXECUTION_POSITION_ID",
          "INVALID_EXECUTION_AMOUNT",
          "INVALID_EXECUTION_ENTRY_PRICE",
          "INVALID_EXECUTION_STOP_LOSS",
          "POSITION_ID_MISMATCH",
          "AMOUNT_MISMATCH",
          "ENTRY_PRICE_MISMATCH",
          "STOP_LOSS_MISMATCH",
        ]),
      );
    }
  });

  it("surfaces Shariah policy drift during reconciliation", () => {
    const position = openPaperPosition(baseInput);
    const execution: PaperExecutionRecord = {
      positionId: position.positionId,
      clientOrderId: "client-test-003",
      symbol: position.symbol,
      amountUsd: position.amountUsd,
      entryPrice: position.entryPrice,
      stopLossPrice: position.stopLossPrice,
      takeProfitPrice: position.takeProfitPrice,
      shariahPolicyVersion: "2026-10-02",
    };

    const result = reconcilePaperExecution(execution, position);
    expect(result.status).toBe("MISMATCHED");
    if (result.status === "MISMATCHED") {
      expect(result.reasons).toContain("SHARIAH_POLICY_VERSION_MISMATCH");
    }
  });
});
