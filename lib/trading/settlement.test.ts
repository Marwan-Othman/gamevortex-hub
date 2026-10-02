import { describe, expect, it } from "vitest";
import { closePaperPosition, openPaperPosition } from "./position";
import { settleClosedPaperPosition } from "./settlement";

function position() {
  return openPaperPosition({
    positionId: "position-1",
    symbol: "TEST",
    amountUsd: 10,
    entryPrice: 100,
    stopLossPrice: 95,
    takeProfitPrice: 110,
    openedAt: "2026-10-02T08:00:00Z",
    shariahPolicyVersion: "strict-v1",
  });
}

describe("settleClosedPaperPosition", () => {
  it("settles a closed paper position using its deterministic P&L", () => {
    const closed = closePaperPosition(position(), {
      exitPrice: 110,
      reason: "TAKE_PROFIT",
      closedAt: "2026-10-02T08:05:00Z",
    });

    const settlement = settleClosedPaperPosition(closed);

    expect(settlement.status).toBe("SETTLED");
    expect(settlement.positionId).toBe("position-1");
    expect(settlement.pnlUsd).toBeCloseTo(1);
    expect(settlement.returnPercent).toBeCloseTo(10);
    expect(settlement.settlementValueUsd).toBeCloseTo(11);
    expect(settlement.shariahPolicyVersion).toBe("strict-v1");
  });

  it("refuses to settle an open position", () => {
    expect(() => settleClosedPaperPosition(position())).toThrow(
      "PAPER_POSITION_MUST_BE_CLOSED",
    );
  });

  it("settles a losing position without changing the deterministic principal", () => {
    const closed = closePaperPosition(position(), {
      exitPrice: 95,
      reason: "STOP_LOSS",
      closedAt: "2026-10-02T08:05:00Z",
    });

    const settlement = settleClosedPaperPosition(closed);

    expect(settlement.status).toBe("SETTLED");
    expect(settlement.pnlUsd).toBeCloseTo(-0.5);
    expect(settlement.returnPercent).toBeCloseTo(-5);
    expect(settlement.settlementValueUsd).toBeCloseTo(9.5);
  });
});
