import type { ShariahAssetInput, ShariahFinancialRatios, TradingMethod } from "./shariah";
import { TradingInputError } from "./errors";

const KNOWN_METHODS: readonly TradingMethod[] = ["SPOT", "MARGIN", "LEVERAGED", "SHORT", "FUTURES", "OPTIONS", "UNKNOWN"];
const RATIO_KEYS: readonly (keyof ShariahFinancialRatios)[] = [
  "interestBearingDebtRatio",
  "interestIncomeRatio",
  "impermissibleIncomeRatio",
];

function optionalText(raw: Record<string, unknown>, field: string, max: number): string | undefined {
  const value = raw[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new TradingInputError("INVALID_SHARIAH_INPUT", field);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new TradingInputError("INVALID_SHARIAH_INPUT", field);
  return trimmed || undefined;
}

function requiredText(raw: Record<string, unknown>, field: string, max: number): string {
  const value = optionalText(raw, field, max);
  if (!value) throw new TradingInputError("INVALID_SHARIAH_INPUT", field);
  return value;
}

/**
 * Untrusted JSON -> ShariahAssetInput.
 * - An unrecognised / missing trading method becomes UNKNOWN (which is prohibited).
 * - ownershipSettlementVerified is true only for the boolean `true`.
 * - Ratios must be real non-negative numbers.
 */
export function parseShariahInput(input: unknown): ShariahAssetInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TradingInputError("INVALID_SHARIAH_INPUT");
  }
  const raw = input as Record<string, unknown>;

  let financialRatios: ShariahFinancialRatios | undefined;
  if (raw.financialRatios !== undefined && raw.financialRatios !== null) {
    const ratios = raw.financialRatios;
    if (typeof ratios !== "object" || Array.isArray(ratios)) {
      throw new TradingInputError("INVALID_SHARIAH_INPUT", "financialRatios");
    }
    financialRatios = {};
    for (const key of RATIO_KEYS) {
      const value = (ratios as Record<string, unknown>)[key];
      if (value === undefined || value === null) continue;
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        throw new TradingInputError("INVALID_SHARIAH_INPUT", `financialRatios.${key}`);
      }
      financialRatios[key] = value;
    }
  }

  const methodRaw = typeof raw.tradingMethod === "string" ? raw.tradingMethod.trim().toUpperCase() : "";
  const tradingMethod: TradingMethod = (KNOWN_METHODS as readonly string[]).includes(methodRaw)
    ? (methodRaw as TradingMethod)
    : "UNKNOWN";

  return {
    symbol: requiredText(raw, "symbol", 32).toUpperCase(),
    assetType: requiredText(raw, "assetType", 32).toUpperCase(),
    issuer: optionalText(raw, "issuer", 200),
    businessActivity: optionalText(raw, "businessActivity", 500),
    financialRatios,
    tradingMethod,
    ownershipSettlementVerified: raw.ownershipSettlementVerified === true,
    source: optionalText(raw, "source", 300),
  };
}
