import { describe, expect, it } from "vitest";

type Outcome = {
  walletCredit: number;
  requiresManualReview: boolean;
  newOrderAllowed: boolean;
};

function handleFailure(kind: string): Outcome {
  switch (kind) {
    case "timeout-after-submit":
    case "provider-rejection":
    case "stale-observation":
    case "reconciliation-mismatch":
    case "protection-failure":
      return { walletCredit: 0, requiresManualReview: true, newOrderAllowed: false };
    case "partial-fill":
      return { walletCredit: 0, requiresManualReview: false, newOrderAllowed: false };
    case "wallet-settlement-failure":
    case "settlement-retry":
      return { walletCredit: 0, requiresManualReview: true, newOrderAllowed: false };
    default:
      throw new Error(`UNKNOWN_FAILURE_DRILL:${kind}`);
  }
}

describe("live trading failure drills", () => {
  const manualReviewCases = [
    "timeout-after-submit",
    "provider-rejection",
    "stale-observation",
    "reconciliation-mismatch",
    "protection-failure",
    "wallet-settlement-failure",
    "settlement-retry",
  ];

  for (const kind of manualReviewCases) {
    it(`${kind} fails closed`, () => {
      const result = handleFailure(kind);
      expect(result.walletCredit).toBe(0);
      expect(result.requiresManualReview).toBe(true);
      expect(result.newOrderAllowed).toBe(false);
    });
  }

  it("partial fill never credits unverified proceeds", () => {
    const result = handleFailure("partial-fill");
    expect(result.walletCredit).toBe(0);
    expect(result.newOrderAllowed).toBe(false);
  });

  it("unknown failure types are rejected", () => {
    expect(() => handleFailure("unknown")).toThrow("UNKNOWN_FAILURE_DRILL:unknown");
  });
});
