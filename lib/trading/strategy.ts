/**
 * GameVortex AI Trading — Strategy Engine foundation.
 *
 * This module only converts already-validated market observations into a
 * deterministic candidate signal. It never places orders, moves money, or
 * bypasses Shariah/Risk controls.
 */

export type StrategySide = "BUY" | "SELL" | "HOLD";

export type StrategyInput = {
  symbol: string;
  price: number;
  previousPrice: number;
  fastAverage: number;
  slowAverage: number;
  volume: number;
  averageVolume: number;
  stopLossPercent: number;
  takeProfitPercent: number;
};

export type StrategyDecision = {
  symbol: string;
  side: StrategySide;
  entryPrice: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  reasons: string[];
};

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function validate(input: StrategyInput): void {
  const values = [
    input.price,
    input.previousPrice,
    input.fastAverage,
    input.slowAverage,
    input.volume,
    input.averageVolume,
    input.stopLossPercent,
    input.takeProfitPercent,
  ];

  if (!input.symbol.trim() || values.some((value) => !positiveFinite(value))) {
    throw new Error("INVALID_STRATEGY_INPUT");
  }
  if (input.stopLossPercent >= 100 || input.takeProfitPercent >= 100) {
    throw new Error("INVALID_STRATEGY_INPUT");
  }
}

/**
 * Conservative trend/volume candidate rule:
 * - BUY when price is above both averages, fast > slow, and volume confirms.
 * - SELL only describes an exit signal; it never represents a short position.
 * - Otherwise HOLD.
 */
export function evaluateStrategy(input: StrategyInput): StrategyDecision {
  validate(input);

  const reasons: string[] = [];
  const trendUp = input.fastAverage > input.slowAverage && input.price > input.slowAverage;
  const priceStrength = input.price > input.previousPrice;
  const volumeConfirmed = input.volume >= input.averageVolume;

  if (!trendUp) reasons.push("TREND_NOT_CONFIRMED");
  if (!priceStrength) reasons.push("PRICE_MOMENTUM_NOT_CONFIRMED");
  if (!volumeConfirmed) reasons.push("VOLUME_NOT_CONFIRMED");

  if (trendUp && priceStrength && volumeConfirmed) {
    const stopLossPrice = input.price * (1 - input.stopLossPercent / 100);
    const takeProfitPrice = input.price * (1 + input.takeProfitPercent / 100);

    return {
      symbol: input.symbol.trim().toUpperCase(),
      side: "BUY",
      entryPrice: input.price,
      stopLossPrice,
      takeProfitPrice,
      reasons: ["UPTREND_CONFIRMED", "PRICE_MOMENTUM_CONFIRMED", "VOLUME_CONFIRMED"],
    };
  }

  return {
    symbol: input.symbol.trim().toUpperCase(),
    side: "HOLD",
    entryPrice: input.price,
    reasons,
  };
}
