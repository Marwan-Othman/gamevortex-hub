import { describe, expect, it } from "vitest";
import {
  mapProviderOrderStatus,
  reconcileLiveOrderObservation,
  type LiveOrderIntent,
  type LiveProviderOrderObservation,
} from "./live-order-reconciliation";

const intent: LiveOrderIntent = {
  clientOrderId: "gv-live-abc123",
  providerOrderId: null,
  symbol: "BTCUSDT",
  side: "BUY",
};

function observation(
  overrides: Partial<LiveProviderOrderObservation> = {},
): LiveProviderOrderObservation {
  return {
    clientOrderId: "gv-live-abc123",
    providerOrderId: "987654321",
    symbol: "BTCUSDT",
    side: "BUY",
    status: "FILLED",
    executedQty: "0.00042",
    cumulativeQuoteQty: "25.00",
    averageFillPrice: "59523.81",
    updatedAt: "2026-10-02T19:00:00.000Z",
    ...overrides,
  };
}

describe("live order reconciliation", () => {
  it("maps Binance-style provider states into the internal state machine", () => {
    expect(mapProviderOrderStatus("NEW")).toBe("SUBMITTED");
    expect(mapProviderOrderStatus("PENDING_NEW")).toBe("SUBMITTED");
    expect(mapProviderOrderStatus("PENDING_CANCEL")).toBe("SUBMITTED");
    expect(mapProviderOrderStatus("PARTIALLY_FILLED")).toBe("PARTIALLY_FILLED");
    expect(mapProviderOrderStatus("FILLED")).toBe("FILLED");
    expect(mapProviderOrderStatus("CANCELED")).toBe("CANCELED");
    expect(mapProviderOrderStatus("REJECTED")).toBe("REJECTED");
    expect(mapProviderOrderStatus("EXPIRED")).toBe("EXPIRED");
  });

  it("accepts a matching provider observation", () => {
    expect(reconcileLiveOrderObservation(intent, observation())).toEqual({
      status: "MATCHED",
      nextState: "FILLED",
      clientOrderId: "gv-live-abc123",
      providerOrderId: "987654321",
      providerStatus: "FILLED",
    });
  });

  it("fails closed on identity drift", () => {
    const result = reconcileLiveOrderObservation(
      intent,
      observation({
        clientOrderId: "other-client-order",
        symbol: "ETHUSDT",
        side: "BUY",
      }),
    );

    expect(result.status).toBe("MISMATCHED");
    if (result.status === "MISMATCHED") {
      expect(result.reasons).toEqual([
        "CLIENT_ORDER_ID_MISMATCH",
        "SYMBOL_MISMATCH",
      ]);
    }
  });

  it("requires a provider order id before accepting a match", () => {
    const result = reconcileLiveOrderObservation(
      intent,
      observation({ providerOrderId: null }),
    );

    expect(result.status).toBe("MISMATCHED");
    if (result.status === "MISMATCHED") {
      expect(result.reasons).toEqual(["PROVIDER_ORDER_ID_MISSING"]);
    }
  });

  it("rejects malformed provider quantities and timestamps", () => {
    const result = reconcileLiveOrderObservation(
      intent,
      observation({
        executedQty: "not-a-number",
        cumulativeQuoteQty: "-1",
        updatedAt: "not-a-date",
      }),
    );

    expect(result.status).toBe("MISMATCHED");
    if (result.status === "MISMATCHED") {
      expect(result.reasons).toEqual([
        "INVALID_EXECUTED_QTY",
        "INVALID_CUMULATIVE_QUOTE_QTY",
        "INVALID_PROVIDER_UPDATE_TIME",
      ]);
    }
  });
});
