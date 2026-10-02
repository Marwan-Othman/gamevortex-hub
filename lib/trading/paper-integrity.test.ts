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

  it("prioritizes stop-loss when both exit levels are touched", () => {
    const position = openPaperPosition(baseInput);
    expect(evaluatePaperPositionExit(position, 98)).toEqual({
      reason: "STOP_LOSS",
      price: 98,
    });
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

  it("settles a closed paper position without changing the simulated accounting result", () => {
    const position = closePaperPosition(openPaperPosition(baseInput), {
      exitPrice: 104,
      reason: "TAKE_PROFIT",
      closedAt: "2026-10-02T07:00:00.000Z",
    });

    const settlement = settleClosedPaperPosition(position);
    expect(settlement.status).toBe("SETTLED");
    expect(settlement.settlementValueUsd).toBeCloseTo(10.4, 10);
    expect(settlement.shariahPolicyVersion).toBe(baseInput.shariahPolicyVersion);
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
      openedAt: position.openedAt,
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
      openedAt: position.openedAt,
      shariahPolicyVersion: position.shariahPolicyVersion,
    };

    const result = reconcilePaperExecution(execution, position);
    expect(result.status).toBe("MISMATCHED");
    if (result.status === "MISMATCHED") {
      expect(result.reasons).toContain("AMOUNT_MISMATCH");
    }
  });
});
