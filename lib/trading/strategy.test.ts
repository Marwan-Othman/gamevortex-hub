import { describe, expect, it } from "vitest";
import { evaluateStrategy } from "./strategy";

const base = {
  symbol: "TEST",
  price: 110,
  previousPrice: 105,
  fastAverage: 108,
  slowAverage: 100,
  volume: 1200,
  averageVolume: 1000,
  stopLossPercent: 2,
  takeProfitPercent: 4,
};

describe("evaluateStrategy", () => {
  it("creates a BUY candidate only after trend, momentum, and volume confirmation", () => {
    const result = evaluateStrategy(base);

    expect(result.side).toBe("BUY");
    expect(result.symbol).toBe("TEST");
    expect(result.stopLossPrice).toBeCloseTo(107.8, 8);
    expect(result.takeProfitPrice).toBeCloseTo(114.4, 8);
  });

  it("holds when volume confirmation is missing", () => {
    const result = evaluateStrategy({ ...base, volume: 900 });

    expect(result.side).toBe("HOLD");
    expect(result.reasons).toContain("VOLUME_NOT_CONFIRMED");
  });

  it("holds when the trend is not confirmed", () => {
    const result = evaluateStrategy({ ...base, fastAverage: 99 });

    expect(result.side).toBe("HOLD");
    expect(result.reasons).toContain("TREND_NOT_CONFIRMED");
  });

  it("rejects invalid or unsafe strategy parameters", () => {
    expect(() => evaluateStrategy({ ...base, price: 0 })).toThrow("INVALID_STRATEGY_INPUT");
    expect(() => evaluateStrategy({ ...base, stopLossPercent: 100 })).toThrow("INVALID_STRATEGY_INPUT");
  });
});
