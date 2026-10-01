/**
 * GameVortex AI Trading — Paper Trading Engine.
 *
 * Paper trading is simulation only. This module never touches wallets,
 * exchange credentials, or real orders. It reuses the same strategy, Shariah,
 * and risk gates that a future executor must respect.
 */

import { evaluatePreTrade, type PreTradeDecision } from "@/lib/trading/pre-trade-guard";
import { evaluateStrategy, type StrategyDecision } from "@/lib/trading/strategy";
import type { RiskConfig } from "@/lib/trading/risk";
import type { ShariahAssetInput, ShariahPolicy } from "@/lib/trading/shariah";

export type PaperTradingTick = {
  timestamp: string;
  price: number;
  previousPrice: number;
  fastAverage: number;
  slowAverage: number;
  volume: number;
  averageVolume: number;
  shariah: ShariahAssetInput;
  circuitBreakerReasons?: readonly string[];
};

export type PaperTradingConfig = {
  symbol: string;
  startingCapitalUsd: number;
  tradeAmountUsd: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  riskConfig: RiskConfig;
  shariahPolicy?: ShariahPolicy;
};

export type PaperTrade = {
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  amountUsd: number;
  pnlUsd: number;
  exitReason: "STOP_LOSS" | "TAKE_PROFIT" | "END_OF_DATA";
  shariahPolicyVersion: string;
};

export type PaperTradingResult = {
  startingCapitalUsd: number;
  finalCapitalUsd: number;
  pnlUsd: number;
  returnPercent: number;
  trades: PaperTrade[];
  blockedSignals: Array<{ timestamp: string; reasons: string[] }>;
  lastPreTradeDecision?: PreTradeDecision;
};

type OpenPosition = {
  entryTime: string;
  entryPrice: number;
  amountUsd: number;
  stopLoss: number;
  takeProfit: number;
  shariahPolicyVersion: string;
};

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function validateConfig(config: PaperTradingConfig): void {
  if (
    !config.symbol.trim() ||
    !positiveFinite(config.startingCapitalUsd) ||
    !positiveFinite(config.tradeAmountUsd) ||
    !positiveFinite(config.stopLossPercent) ||
    !positiveFinite(config.takeProfitPercent) ||
    config.stopLossPercent >= 100 ||
    config.takeProfitPercent >= 100 ||
    config.tradeAmountUsd > config.startingCapitalUsd
  ) {
    throw new Error("INVALID_PAPER_TRADING_CONFIG");
  }
}

function validateTick(tick: PaperTradingTick): void {
  if (
    !tick.timestamp ||
    ![
      tick.price,
      tick.previousPrice,
      tick.fastAverage,
      tick.slowAverage,
      tick.volume,
      tick.averageVolume,
    ].every(positiveFinite)
  ) {
    throw new Error("INVALID_PAPER_TRADING_TICK");
  }
}

/**
 * Runs a deterministic paper-trading session over supplied market ticks.
 * One spot position is allowed at a time. If stop-loss and take-profit are
 * both touched in one tick, stop-loss wins because intratick order is unknown.
 */
export function runPaperTrading(
  config: PaperTradingConfig,
  ticks: readonly PaperTradingTick[],
): PaperTradingResult {
  validateConfig(config);
  if (ticks.length === 0) throw new Error("INVALID_PAPER_TRADING_INPUT");
  ticks.forEach(validateTick);

  let capital = config.startingCapitalUsd;
  let dailyLossUsd = 0;
  let consecutiveLosses = 0;
  let position: OpenPosition | undefined;
  const trades: PaperTrade[] = [];
  const blockedSignals: PaperTradingResult["blockedSignals"] = [];
  let lastPreTradeDecision: PreTradeDecision | undefined;

  for (const tick of ticks) {
    if (position) {
      let exitPrice: number | undefined;
      let exitReason: PaperTrade["exitReason"] | undefined;

      if (tick.price <= position.stopLoss) {
        exitPrice = position.stopLoss;
        exitReason = "STOP_LOSS";
      } else if (tick.price >= position.takeProfit) {
        exitPrice = position.takeProfit;
        exitReason = "TAKE_PROFIT";
      }

      if (exitPrice !== undefined && exitReason) {
        const pnlUsd = position.amountUsd * ((exitPrice - position.entryPrice) / position.entryPrice);
        capital += pnlUsd;
        if (pnlUsd < 0) {
          dailyLossUsd += Math.abs(pnlUsd);
          consecutiveLosses += 1;
        } else {
          consecutiveLosses = 0;
        }

        trades.push({
          entryTime: position.entryTime,
          exitTime: tick.timestamp,
          entryPrice: position.entryPrice,
          exitPrice,
          amountUsd: position.amountUsd,
          pnlUsd,
          exitReason,
          shariahPolicyVersion: position.shariahPolicyVersion,
        });
        position = undefined;
      }

      continue;
    }

    const strategy: StrategyDecision = evaluateStrategy({
      symbol: config.symbol,
      price: tick.price,
      previousPrice: tick.previousPrice,
      fastAverage: tick.fastAverage,
      slowAverage: tick.slowAverage,
      volume: tick.volume,
      averageVolume: tick.averageVolume,
      stopLossPercent: config.stopLossPercent,
      takeProfitPercent: config.takeProfitPercent,
    });

    if (strategy.side !== "BUY") continue;

    const riskSnapshot = {
      requestedAmountUsd: config.tradeAmountUsd,
      dailyLossUsd,
      openTrades: 0,
      totalExposureUsd: 0,
      assetExposureUsd: 0,
      consecutiveLosses,
      hasStopLoss: strategy.stopLossPrice !== undefined,
      hasTakeProfit: strategy.takeProfitPrice !== undefined,
      circuitBreakerReasons: tick.circuitBreakerReasons,
    };

    const decision = evaluatePreTrade({
      shariah: tick.shariah,
      riskConfig: config.riskConfig,
      riskSnapshot,
      shariahPolicy: config.shariahPolicy,
    });
    lastPreTradeDecision = decision;

    if (!decision.allowed) {
      blockedSignals.push({ timestamp: tick.timestamp, reasons: decision.reasons });
      continue;
    }

    position = {
      entryTime: tick.timestamp,
      entryPrice: strategy.entryPrice,
      amountUsd: config.tradeAmountUsd,
      stopLoss: strategy.stopLossPrice!,
      takeProfit: strategy.takeProfitPrice!,
      shariahPolicyVersion: decision.shariah.policyVersion,
    };
  }

  if (position) {
    const finalTick = ticks[ticks.length - 1];
    const pnlUsd = position.amountUsd * ((finalTick.price - position.entryPrice) / position.entryPrice);
    capital += pnlUsd;
    if (pnlUsd < 0) dailyLossUsd += Math.abs(pnlUsd);
    trades.push({
      entryTime: position.entryTime,
      exitTime: finalTick.timestamp,
      entryPrice: position.entryPrice,
      exitPrice: finalTick.price,
      amountUsd: position.amountUsd,
      pnlUsd,
      exitReason: "END_OF_DATA",
      shariahPolicyVersion: position.shariahPolicyVersion,
    });
  }

  const pnlUsd = capital - config.startingCapitalUsd;
  return {
    startingCapitalUsd: config.startingCapitalUsd,
    finalCapitalUsd: capital,
    pnlUsd,
    returnPercent: (pnlUsd / config.startingCapitalUsd) * 100,
    trades,
    blockedSignals,
    lastPreTradeDecision,
  };
}
