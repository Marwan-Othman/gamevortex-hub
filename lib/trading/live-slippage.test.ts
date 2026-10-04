import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIVE_MAX_SLIPPAGE_PERCENT,
  evaluateBuySlippage,
  isObservationFresh,
  resolveMaxSlippagePercent,
} from "./live-slippage";

describe("resolveMaxSlippagePercent", () => {
  it("defaults when unset or blank", () => {
    expect(resolveMaxSlippagePercent(undefined)).toBe(DEFAULT_LIVE_MAX_SLIPPAGE_PERCENT);
    expect(resolveMaxSlippagePercent("  ")).toBe(DEFAULT_LIVE_MAX_SLIPPAGE_PERCENT);
  });

  it("accepts a valid override", () => {
    expect(resolveMaxSlippagePercent("1.25")).toBe(1.25);
  });

  it("rejects out-of-range or malformed overrides instead of silently loosening the guard", () => {
    for (const bad of ["0", "0.01", "6", "-1", "abc", "NaN", "Infinity"]) {
      expect(() => resolveMaxSlippagePercent(bad)).toThrow("INVALID_TRADING_LIVE_MAX_SLIPPAGE_PERCENT");
    }
  });
});

describe("evaluateBuySlippage", () => {
  it("allows a price at or below the approved price", () => {
    expect(evaluateBuySlippage({ expectedPrice: 100, observedPrice: 100, maxPercent: 0.5 }).allowed).toBe(true);
    expect(evaluateBuySlippage({ expectedPrice: 100, observedPrice: 95, maxPercent: 0.5 }).allowed).toBe(true);
  });

  it("allows adverse movement exactly at the limit", () => {
    expect(evaluateBuySlippage({ expectedPrice: 100, observedPrice: 100.5, maxPercent: 0.5 }).allowed).toBe(true);
  });

  it("blocks adverse movement above the limit", () => {
    const decision = evaluateBuySlippage({ expectedPrice: 100, observedPrice: 101, maxPercent: 0.5 });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("SLIPPAGE_EXCEEDS_LIMIT");
    expect(decision.slippagePercent).toBeCloseTo(1, 10);
  });

  it("fails closed on invalid input", () => {
    for (const input of [
      { expectedPrice: 0, observedPrice: 100, maxPercent: 0.5 },
      { expectedPrice: 100, observedPrice: Number.NaN, maxPercent: 0.5 },
      { expectedPrice: 100, observedPrice: 100, maxPercent: 0 },
      { expectedPrice: -1, observedPrice: 100, maxPercent: 0.5 },
    ]) {
      const decision = evaluateBuySlippage(input);
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe("INVALID_SLIPPAGE_INPUT");
    }
  });
});

describe("isObservationFresh", () => {
  const now = Date.parse("2026-10-04T12:00:00.000Z");

  it("accepts a recent observation", () => {
    expect(isObservationFresh("2026-10-04T11:59:30.000Z", now)).toBe(true);
  });

  it("rejects a stale observation", () => {
    expect(isObservationFresh("2026-10-04T11:50:00.000Z", now)).toBe(false);
  });

  it("rejects an observation from the future and invalid timestamps", () => {
    expect(isObservationFresh("2026-10-04T12:10:00.000Z", now)).toBe(false);
    expect(isObservationFresh("not-a-date", now)).toBe(false);
  });
});
