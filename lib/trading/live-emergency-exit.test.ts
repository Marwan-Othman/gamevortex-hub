import { describe, expect, it } from "vitest";
import { attemptEmergencyExit, buildEmergencySellClientOrderId } from "./live-emergency-exit";

const base = { symbol: "SOLUSDT", entryClientOrderId: "gv-live-entry-1", quantity: "9.99" };

describe("buildEmergencySellClientOrderId", () => {
  it("is deterministic and within Binance's 36 character limit", () => {
    const a = buildEmergencySellClientOrderId("gv-live-entry-1");
    expect(a).toBe(buildEmergencySellClientOrderId("gv-live-entry-1"));
    expect(a).not.toBe(buildEmergencySellClientOrderId("gv-live-entry-2"));
    expect(a.length).toBeLessThanOrEqual(36);
    expect(a).toMatch(/^[A-Za-z0-9._:-]+$/);
  });
});

describe("attemptEmergencyExit", () => {
  it("sells the given quantity once and reports SOLD", async () => {
    const calls: Array<{ clientOrderId: string; symbol: string; quantity: string }> = [];
    const outcome = await attemptEmergencyExit({
      ...base,
      adapter: {
        placeEmergencyMarketSell: async (request) => {
          calls.push(request);
          return { accepted: true, clientOrderId: request.clientOrderId, providerOrderId: "77", status: "FILLED", executedQty: 9.99, cumulativeQuoteQty: 1000 };
        },
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].quantity).toBe("9.99");
    expect(calls[0].symbol).toBe("SOLUSDT");
    expect(outcome.status).toBe("SOLD");
  });

  it("reports FAILED (never throws) when the exchange rejects", async () => {
    const outcome = await attemptEmergencyExit({
      ...base,
      adapter: {
        placeEmergencyMarketSell: async (request) => ({ accepted: false, clientOrderId: request.clientOrderId, status: "REJECTED" }),
      },
    });
    expect(outcome.status).toBe("FAILED");
  });

  it("reports FAILED (never throws) on a network timeout", async () => {
    const outcome = await attemptEmergencyExit({
      ...base,
      adapter: {
        placeEmergencyMarketSell: async () => {
          throw new Error("BINANCE_LIVE_NETWORK_ERROR");
        },
      },
    });
    expect(outcome).toEqual({
      status: "FAILED",
      clientOrderId: buildEmergencySellClientOrderId(base.entryClientOrderId),
      reason: "BINANCE_LIVE_NETWORK_ERROR",
    });
  });

  it("reports FAILED when the adapter cannot sell or the quantity is invalid", async () => {
    expect((await attemptEmergencyExit({ ...base, adapter: {} })).status).toBe("FAILED");
    for (const quantity of ["0", "-1", "1e-7", ""]) {
      const outcome = await attemptEmergencyExit({
        ...base,
        quantity,
        adapter: { placeEmergencyMarketSell: async () => { throw new Error("must not be called"); } },
      });
      expect(outcome.status).toBe("FAILED");
    }
  });
});
