import { describe, expect, it } from "vitest";
import { attemptEmergencyExit } from "./live-emergency-exit";
import { computeSellableQuantity } from "./live-sellable-quantity";
import { evaluateBuySlippage, isObservationFresh } from "./live-slippage";

/**
 * Failure drills against the REAL guard modules (not local stand-ins).
 * Executor-level drills that need a database are still to be added once a
 * test database is available in CI.
 */
describe("live failure drills", () => {
  it("slippage spike between approval and submission blocks the BUY", () => {
    const decision = evaluateBuySlippage({ expectedPrice: 100, observedPrice: 103, maxPercent: 0.5 });
    expect(decision.allowed).toBe(false);
  });

  it("stale market data blocks the BUY", () => {
    const now = Date.parse("2026-10-04T12:00:00.000Z");
    expect(isObservationFresh("2026-10-04T11:40:00.000Z", now)).toBe(false);
  });

  it("protection failure: emergency sell uses the net (post-commission) quantity", async () => {
    const quantity = computeSellableQuantity({
      executedQty: "10",
      baseAsset: "SOL",
      fees: [{ commission: "0.01", commissionAsset: "SOL" }],
      stepSize: "0.01",
    });
    let sold = "";
    const outcome = await attemptEmergencyExit({
      symbol: "SOLUSDT",
      entryClientOrderId: "gv-live-drill",
      quantity,
      adapter: {
        placeEmergencyMarketSell: async (request) => {
          sold = request.quantity;
          return { accepted: true, clientOrderId: request.clientOrderId, status: "FILLED" };
        },
      },
    });
    expect(outcome.status).toBe("SOLD");
    expect(sold).toBe("9.99");
  });

  it("protection failure + emergency sell timeout: reported as FAILED so manual review is forced", async () => {
    const outcome = await attemptEmergencyExit({
      symbol: "SOLUSDT",
      entryClientOrderId: "gv-live-drill",
      quantity: "9.99",
      adapter: { placeEmergencyMarketSell: async () => { throw new Error("timeout"); } },
    });
    expect(outcome.status).toBe("FAILED");
  });

  it("entry commission that consumes the whole fill leaves nothing to protect or sell", () => {
    expect(() =>
      computeSellableQuantity({
        executedQty: "1",
        baseAsset: "SOL",
        fees: [{ commission: "1", commissionAsset: "SOL" }],
      }),
    ).toThrow("LIVE_SELLABLE_QUANTITY_NOT_POSITIVE");
  });
});
