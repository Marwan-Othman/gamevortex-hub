/**
 * GameVortex AI Trading — Paper Trading Engine.
 *
 * Paper trading is simulation only. This module never touches wallets,
 * exchange credentials, or real orders. It reuses the same strategy, Shariah,
 * risk, and position-lifecycle gates that a future executor must respect.
 */

import { evaluatePreTrade, type PreTradeDecision } from "@/lib/trading/pre-trade-guard";
import {
  closePaperPosition,
  evaluatePaperPositionExit,
  openPaperPosition,
  type PaperPosition,
} from "@/lib/trading/position";
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

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function normalizeSymbol(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!normalized || !/^[A-Z0-9._:-]{1,32}$/.test(normalized)) {
    throw new Error("INVALID_PAPER_TRADING_CONFIG");
  }
  return normalized;
}

function validateConfig(config: PaperTradingConfig): string {
  let symbol: string;
  try {
    symbol = normalizeSymbol(config.symbol);
  } catch {
    throw new Error("INVALID_PAPER_TRADING_CONFIG");
  }

  if (
    !positiveFinite(config.startingCapitalUsd) ||
    !positiveFinite(config.tradeAmountUsd) ||
    !positiveFinite(config.stopLossPercent) ||
    !positiveFinite(config.takeProfitPercent) ||
    config.stopLossPercent >= 100 ||
    config.takeProfitPercent >= 100 ||
    config.tradeAmountUsd < 1 ||
    config.tradeAmountUsd > config.startingCapitalUsd
  ) {
    throw new Error("INVALID_PAPER_TRADING_CONFIG");
  }

  return symbol;
}

function validateTick(tick: PaperTradingTick, expectedSymbol: string): void {
  if (
    !Number.isFinite(Date.parse(tick.timestamp)) ||
    [
      tick.price,
      tick.previousPrice,
      tick.fastAverage,
      tick.slowAverage,
      tick.volume,
      tick.averageVolume,
    ].some((value) => !positiveFinite(value))
  ) {
    throw new Error("INVALID_PAPER_TRADING_TICK");
  }

  const tickSymbol =
    typeof tick.shariah.symbol === "string" ? tick.shariah.symbol.trim().toUpperCase() : "";
  if (!tickSymbol || tickSymbol !== expectedSymbol) {
    throw new Error("PAPER_TRADING_SYMBOL_MISMATCH");
  }
}

function validateTickSeries(
  ticks: readonly PaperTradingTick[],
  expectedSymbol: string,
): void {
  ticks.forEach((tick) => validateTick(tick, expectedSymbol));

  for (let index = 1; index < ticks.length; index += 1) {
    const previousTimestamp = Date.parse(ticks[index - 1].timestamp);
    const currentTimestamp = Date.parse(ticks[index].timestamp);
    if (currentTimestamp <= previousTimestamp) {
      throw new Error("INVALID_PAPER_TRADING_TIMESTAMP_ORDER");
    }
  }
}

function utcDayKey(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) throw new Error("INVALID_PAPER_TRADING_TICK");
  return date.toISOString().slice(0, 10);
}

function closePositionToTrade(position: PaperPosition): PaperTrade {
  if (position.status !== "CLOSED" || !position.closedAt || position.exitPrice === undefined) {
    throw new Error("INVALID_CLOSED_PAPER_POSITION");
  }

  if (
    position.exitReason !== "STOP_LOSS" &&
    position.exitReason !== "TAKE_PROFIT" &&
    position.exitReason !== "END_OF_DATA"
  ) {
    throw new Error("INVALID_PAPER_TRADE_EXIT_REASON");
  }

  return {
    entryTime: position.openedAt,
    exitTime: position.closedAt,
    entryPrice: position.entryPrice,
    exitPrice: position.exitPrice,
    amountUsd: position.amountUsd,
    pnlUsd: position.pnlUsd ?? 0,
    exitReason: position.exitReason,
    shariahPolicyVersion: position.shariahPolicyVersion,
  };
}

/**
 * Runs a deterministic paper-trading session over supplied market ticks.
 * One spot BUY position is allowed at a time.
 *
 * Daily-loss accounting is reset at each UTC calendar-day boundary. This is
 * important because Risk Manager's maxDailyLossUsd is a daily limit, not a
 * lifetime/session loss limit. Consecutive-loss protection remains cumulative
 * for the entire simulation because it is a separate circuit-breaker rule.
 */
export function runPaperTrading(
  config: PaperTradingConfig,
  ticks: readonly PaperTradingTick[],
): PaperTradingResult {
  const symbol = validateConfig(config);
  if (ticks.length === 0) throw new Error("INVALID_PAPER_TRADING_INPUT");
  validateTickSeries(ticks, symbol);

  let capital = config.startingCapitalUsd;
  let dailyLossUsd = 0;
  let currentUtcDay = utcDayKey(ticks[0].timestamp);
  let consecutiveLosses = 0;
  let position: PaperPosition | undefined;
  const trades: PaperTrade[] = [];
  const blockedSignals: PaperTradingResult["blockedSignals"] = [];
  let lastPreTradeDecision: PreTradeDecision | undefined;

  for (let index = 0; index < ticks.length; index += 1) {
    const tick = ticks[index];
    const tickUtcDay = utcDayKey(tick.timestamp);

    if (tickUtcDay !== currentUtcDay) {
      dailyLossUsd = 0;
      currentUtcDay = tickUtcDay;
    }

    if (position) {
      const exit = evaluatePaperPositionExit(position, tick.price);

      if (exit) {
        position = closePaperPosition(position, {
          exitPrice: exit.price,
          reason: exit.reason,
          closedAt: tick.timestamp,
        });

        const trade = closePositionToTrade(position);
        trades.push(trade);
        capital += trade.pnlUsd;

        if (trade.pnlUsd < 0) {
          dailyLossUsd += Math.abs(trade.pnlUsd);
          consecutiveLosses += 1;
        } else {
          consecutiveLosses = 0;
        }

        position = undefined;
      }

      continue;
    }

    const strategy: StrategyDecision = evaluateStrategy({
      symbol,
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

    if (capital < config.tradeAmountUsd) {
      blockedSignals.push({
        timestamp: tick.timestamp,
        reasons: ["INSUFFICIENT_PAPER_CAPITAL"],
      });
      continue;
    }

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

    if (strategy.stopLossPrice === undefined) {
      blockedSignals.push({
        timestamp: tick.timestamp,
        reasons: ["STOP_LOSS_REQUIRED"],
      });
      continue;
    }

    position = openPaperPosition({
      positionId: `paper-${symbol}-${index}`,
      symbol,
      amountUsd: config.tradeAmountUsd,
      entryPrice: strategy.entryPrice,
      stopLossPrice: strategy.stopLossPrice,
      takeProfitPrice: strategy.takeProfitPrice,
      openedAt: tick.timestamp,
      shariahPolicyVersion: decision.shariah.policyVersion,
    });
  }

  if (position) {
    const finalTick = ticks[ticks.length - 1];
    position = closePaperPosition(position, {
      exitPrice: finalTick.price,
      reason: "END_OF_DATA",
      closedAt: finalTick.timestamp,
    });

    const trade = closePositionToTrade(position);
    trades.push(trade);
    capital += trade.pnlUsd;
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
