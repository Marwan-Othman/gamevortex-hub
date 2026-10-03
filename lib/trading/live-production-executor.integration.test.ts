import { describe, expect, it } from "vitest";

type GateState = {
  tradingEnabled: boolean;
  controlOpen: boolean;
  preflightReady: boolean;
  approvalValid: boolean;
  riskApproved: boolean;
  shariahApproved: boolean;
  allocationAvailable: boolean;
};

function canSubmitOrder(state: GateState): boolean {
  return Object.values(state).every(Boolean);
}

describe("live production executor safety gates", () => {
  const safeBase: GateState = {
    tradingEnabled: true,
    controlOpen: true,
    preflightReady: true,
    approvalValid: true,
    riskApproved: true,
    shariahApproved: true,
    allocationAvailable: true,
  };

  it("allows submission only when every gate is explicitly open", () => {
    expect(canSubmitOrder(safeBase)).toBe(true);
  });

  for (const gate of Object.keys(safeBase) as Array<keyof GateState>) {
    it(`blocks submission when ${gate} is closed`, () => {
      expect(canSubmitOrder({ ...safeBase, [gate]: false })).toBe(false);
    });
  }
});
