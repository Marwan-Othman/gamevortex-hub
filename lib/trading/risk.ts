/**
 * GameVortex AI Trading — Risk Manager.
 *
 * Pure, deterministic checks. No UI or AI call can bypass these checks; the
 * future Trading Executor must call this module before sending an order.
 */

export type RiskConfig = {
  maxTradeAmountUsd: number;
  maxDailyLossUsd: number;
  maxOpenTrades: number;
  maxExposureUsd: number;
  maxExposurePerAssetUsd: number;
  maxConsecutiveLosses: number;
  requireStopLoss: boolean;
  requireTakeProfit: boolean;
};

export type RiskSnapshot = {
  requestedAmountUsd: number;
  dailyLossUsd: number;
  openTrades: number;
  totalExposureUsd: number;
  assetExposureUsd: number;
  consecutiveLosses: number;
  hasStopLoss: boolean;
  hasTakeProfit: boolean;
  circuitBreakerReasons?: readonly string[];
};

export type RiskDecision = {
  allowed: boolean;
  reasons: string[];
};

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

export function validateRiskConfig(config: RiskConfig): void {
  const numeric = [
    config.maxTradeAmountUsd,
    config.maxDailyLossUsd,
    config.maxExposureUsd,
    config.maxExposurePerAssetUsd,
  ];
  if (numeric.some((value) => !finiteNonNegative(value))) throw new Error("INVALID_RISK_CONFIG");
  if (!positiveInteger(config.maxOpenTrades) || !positiveInteger(config.maxConsecutiveLosses)) {
    throw new Error("INVALID_RISK_CONFIG");
  }
  if (config.maxTradeAmountUsd < 1) throw new Error("INVALID_RISK_CONFIG");
}

export function evaluateRisk(config: RiskConfig, snapshot: RiskSnapshot): RiskDecision {
  validateRiskConfig(config);
  const reasons: string[] = [];

  if (!finiteNonNegative(snapshot.requestedAmountUsd) || snapshot.requestedAmountUsd < 1) {
    reasons.push("INVALID_TRADE_AMOUNT");
  }
  if (!finiteNonNegative(snapshot.dailyLossUsd)) reasons.push("INVALID_DAILY_LOSS");
  if (!positiveInteger(snapshot.openTrades + 1)) reasons.push("INVALID_OPEN_TRADES");
  if (!finiteNonNegative(snapshot.totalExposureUsd) || !finiteNonNegative(snapshot.assetExposureUsd)) {
    reasons.push("INVALID_EXPOSURE");
  }
  if (!positiveInteger(snapshot.consecutiveLosses + 1)) reasons.push("INVALID_CONSECUTIVE_LOSSES");

  if (snapshot.requestedAmountUsd > config.maxTradeAmountUsd) reasons.push("MAX_TRADE_AMOUNT_EXCEEDED");
  if (snapshot.dailyLossUsd >= config.maxDailyLossUsd) reasons.push("MAX_DAILY_LOSS_REACHED");
  if (snapshot.openTrades >= config.maxOpenTrades) reasons.push("MAX_OPEN_TRADES_REACHED");
  if (snapshot.totalExposureUsd + snapshot.requestedAmountUsd > config.maxExposureUsd) reasons.push("MAX_EXPOSURE_EXCEEDED");
  if (snapshot.assetExposureUsd + snapshot.requestedAmountUsd > config.maxExposurePerAssetUsd) reasons.push("MAX_ASSET_EXPOSURE_EXCEEDED");
  if (snapshot.consecutiveLosses >= config.maxConsecutiveLosses) reasons.push("MAX_CONSECUTIVE_LOSSES_REACHED");
  if (config.requireStopLoss && !snapshot.hasStopLoss) reasons.push("STOP_LOSS_REQUIRED");
  if (config.requireTakeProfit && !snapshot.hasTakeProfit) reasons.push("TAKE_PROFIT_REQUIRED");

  for (const reason of snapshot.circuitBreakerReasons ?? []) reasons.push(`CIRCUIT_BREAKER:${reason}`);

  return { allowed: reasons.length === 0, reasons };
}

export function assertRiskAllowed(decision: RiskDecision): void {
  if (!decision.allowed) throw new Error(`RISK_BLOCKED:${decision.reasons.join(",")}`);
}
