import type { RiskConfig } from "./risk";
import { TradingInputError } from "./errors";

/** Real JS numbers only. Strings such as "10" are rejected on purpose. */
function requireNumber(raw: Record<string, unknown>, field: string): number {
  const value = raw[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TradingInputError("INVALID_RISK_CONFIG", field);
  }
  return value;
}

function requireBoolean(raw: Record<string, unknown>, field: string, fallback: boolean): boolean {
  const value = raw[field];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new TradingInputError("INVALID_RISK_CONFIG", field);
  return value;
}

export function parseRiskConfigInput(input: unknown): RiskConfig {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TradingInputError("INVALID_RISK_CONFIG");
  }
  const raw = input as Record<string, unknown>;

  const maxTradeAmountUsd = requireNumber(raw, "maxTradeAmountUsd");
  const maxDailyLossUsd = requireNumber(raw, "maxDailyLossUsd");
  const maxOpenTrades = requireNumber(raw, "maxOpenTrades");
  const maxExposureUsd = requireNumber(raw, "maxExposureUsd");
  const maxExposurePerAssetUsd = requireNumber(raw, "maxExposurePerAssetUsd");
  const maxConsecutiveLosses = requireNumber(raw, "maxConsecutiveLosses");

  if (maxTradeAmountUsd < 1) throw new TradingInputError("INVALID_RISK_CONFIG", "maxTradeAmountUsd");
  if (maxDailyLossUsd < 0) throw new TradingInputError("INVALID_RISK_CONFIG", "maxDailyLossUsd");
  if (!Number.isSafeInteger(maxOpenTrades) || maxOpenTrades < 1) {
    throw new TradingInputError("INVALID_RISK_CONFIG", "maxOpenTrades");
  }
  if (maxExposureUsd < 0) throw new TradingInputError("INVALID_RISK_CONFIG", "maxExposureUsd");
  if (maxExposurePerAssetUsd < 0) throw new TradingInputError("INVALID_RISK_CONFIG", "maxExposurePerAssetUsd");
  if (maxExposurePerAssetUsd > maxExposureUsd) {
    throw new TradingInputError("INVALID_RISK_CONFIG", "maxExposurePerAssetUsd");
  }
  if (!Number.isSafeInteger(maxConsecutiveLosses) || maxConsecutiveLosses < 1) {
    throw new TradingInputError("INVALID_RISK_CONFIG", "maxConsecutiveLosses");
  }

  return {
    maxTradeAmountUsd,
    maxDailyLossUsd,
    maxOpenTrades,
    maxExposureUsd,
    maxExposurePerAssetUsd,
    maxConsecutiveLosses,
    requireStopLoss: requireBoolean(raw, "requireStopLoss", true),
    requireTakeProfit: requireBoolean(raw, "requireTakeProfit", false),
  };
}
