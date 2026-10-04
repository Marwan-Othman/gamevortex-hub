import { writeFile } from "node:fs/promises";
import { runStrategyLab } from "../lib/trading/strategy-lab.ts";

const SYMBOLS = ["BNBUSDT", "XRPUSDT", "ADAUSDT", "DOGEUSDT"];
const INTERVAL = "4h";
const CANDLES = 5_000;
const SHIFT_DAYS = 365;
const CONFIG = {
  initialCapitalUsd: 100,
  tradeAmountUsd: 10,
  feePercent: 0.1,
  slippagePercent: 0.05,
};
const BASE_URL = "https://data-api.binance.vision/api/v3/klines";

async function fetchWindow(symbol, endTimeMs) {
  const byTime = new Map();
  let cursorEndTimeMs = endTimeMs;
  for (let page = 0; page < 7 && byTime.size < CANDLES; page += 1) {
    const params = new URLSearchParams({ symbol, interval: INTERVAL, limit: String(Math.min(1_000, CANDLES - byTime.size)) });
    if (cursorEndTimeMs !== undefined) params.set("endTime", String(cursorEndTimeMs));
    const response = await fetch(`${BASE_URL}?${params.toString()}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`BINANCE_PUBLIC_HTTP_${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload)) throw new Error("BINANCE_PUBLIC_INVALID_RESPONSE");
    if (payload.length === 0) break;
    const before = byTime.size;
    for (const row of payload) {
      if (!Array.isArray(row) || row.length < 6) throw new Error("BINANCE_PUBLIC_INVALID_KLINE");
      const [openTime, open, high, low, close, volume] = row;
      byTime.set(String(openTime), {
        timestamp: new Date(Number(openTime)).toISOString(),
        open: Number(open),
        high: Number(high),
        low: Number(low),
        close: Number(close),
        volume: Number(volume),
      });
    }
    if (byTime.size === before) break;
    cursorEndTimeMs = Math.min(...payload.map((row) => Number(row[0]))) - 1;
  }
  const candles = [...byTime.values()].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  if (candles.length !== CANDLES) {
    throw new Error(`INSUFFICIENT_CANDLES:${symbol}:${candles.length}`);
  }
  return candles;
}

function summarize(windowName, endTimeMs, result) {
  return {
    window: windowName,
    endTimeMs: endTimeMs ?? null,
    endTimeIso: endTimeMs ? new Date(endTimeMs).toISOString() : null,
    symbols: SYMBOLS,
    interval: INTERVAL,
    candlesPerSymbol: CANDLES,
    totalCombinations: result.totalCombinations,
    trainCandles: result.trainCandles,
    testCandles: result.testCandles,
    robustCount: result.robustCount,
    criteriaSatisfied: result.robustCount > 0,
    benchmarks: result.benchmarks,
    topRows: result.rows.map((row) => ({
      id: row.id,
      family: row.family,
      label: row.label,
      avgTrainReturn: row.avgTrainReturn,
      avgTestReturn: row.avgTestReturn,
      trainPositiveSymbols: row.trainPositiveSymbols,
      testPositiveSymbols: row.testPositiveSymbols,
      minTrades: row.minTrades,
      robust: row.robust,
      perSymbol: row.perSymbol,
    })),
    bestPerFamily: result.bestPerFamily.map((row) => ({
      id: row.id,
      family: row.family,
      label: row.label,
      avgTrainReturn: row.avgTrainReturn,
      avgTestReturn: row.avgTestReturn,
      trainPositiveSymbols: row.trainPositiveSymbols,
      testPositiveSymbols: row.testPositiveSymbols,
      minTrades: row.minTrades,
      robust: row.robust,
    })),
  };
}

async function run() {
  const now = Date.now();
  const shiftedEndTimeMs = now - SHIFT_DAYS * 24 * 60 * 60 * 1_000;
  const windows = [
    { name: "recent", endTimeMs: undefined },
    { name: "shifted_365d", endTimeMs: shiftedEndTimeMs },
  ];
  const reports = [];

  for (const window of windows) {
    const datasets = [];
    for (const symbol of SYMBOLS) {
      const candles = await fetchWindow(symbol, window.endTimeMs);
      datasets.push({ symbol, candles });
    }
    const result = runStrategyLab(datasets, CONFIG);
    reports.push(summarize(window.name, window.endTimeMs, result));
  }

  const finalReport = {
    generatedAt: new Date().toISOString(),
    methodology: {
      symbols: SYMBOLS,
      interval: INTERVAL,
      candlesPerSymbol: CANDLES,
      feePercent: CONFIG.feePercent,
      slippagePercent: CONFIG.slippagePercent,
      trainTestSplit: "chronological 70/30 after 200-candle warmup",
      minimumTradesPerSymbolPerSegment: 15,
      requiredPositiveSymbols: "strict majority",
      ranking: "TRAIN only; TEST is never used for ranking",
      windows: "recent and a separate window ending 365 days earlier",
    },
    windows: reports,
    overallCriteriaSatisfied: reports.every((report) => report.criteriaSatisfied),
  };

  await writeFile("strategy-lab-research-report.json", `${JSON.stringify(finalReport, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(finalReport, null, 2));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
