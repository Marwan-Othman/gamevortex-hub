"use client";

import { useState } from "react";
import styles from "../../app/admin/admin.module.css";

type BacktestTrade = {
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  amountUsd: number;
  pnlUsd: number;
  exitReason: "STOP_LOSS" | "TAKE_PROFIT" | "END_OF_DATA";
};

type BacktestResult = {
  initialCapitalUsd: number;
  finalCapitalUsd: number;
  pnlUsd: number;
  returnPercent: number;
  maxDrawdownUsd: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRatePercent: number;
  trades: BacktestTrade[];
};

type Candle = {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  fastAverage: number;
  slowAverage: number;
  averageVolume: number;
};

const ERROR_TEXT: Record<string, string> = {
  INVALID_BACKTEST_INPUT: "بيانات الاختبار غير صالحة.",
  INVALID_BACKTEST_CANDLE: "إحدى شموع السوق غير صالحة.",
  INVALID_BACKTEST_CONFIG: "إعدادات الاختبار غير صالحة.",
  FORBIDDEN: "غير مصرح.",
  RATE_LIMITED: "تم تجاوز حد الطلبات مؤقتًا.",
};

const SAMPLE_CANDLES: Candle[] = [
  { timestamp: "2026-10-01T10:00:00.000Z", open: 100, high: 101, low: 99, close: 100, volume: 1000, fastAverage: 99, slowAverage: 98, averageVolume: 900 },
  { timestamp: "2026-10-01T10:05:00.000Z", open: 100, high: 103, low: 99.5, close: 102, volume: 1300, fastAverage: 101, slowAverage: 99, averageVolume: 1000 },
  { timestamp: "2026-10-01T10:10:00.000Z", open: 102, high: 105, low: 101, close: 104, volume: 1500, fastAverage: 103, slowAverage: 100, averageVolume: 1100 },
];

type TestnetCandle = { timestamp: string; open: number; high: number; low: number; close: number; volume: number };

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function withAverages(candles: TestnetCandle[]): Candle[] {
  return candles.map((candle, index) => {
    const fast = candles.slice(Math.max(0, index - 4), index + 1).map((item) => item.close);
    const slow = candles.slice(Math.max(0, index - 19), index + 1).map((item) => item.close);
    const vols = candles.slice(Math.max(0, index - 19), index + 1).map((item) => item.volume);
    return { ...candle, fastAverage: average(fast), slowAverage: average(slow), averageVolume: average(vols) };
  });
}

function numberField(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default function TradingBacktestPanel() {
  const [symbol, setSymbol] = useState("BTC/USDT");
  const [initialCapitalUsd, setInitialCapitalUsd] = useState("100");
  const [tradeAmountUsd, setTradeAmountUsd] = useState("1");
  const [stopLossPercent, setStopLossPercent] = useState("2");
  const [takeProfitPercent, setTakeProfitPercent] = useState("4");
  const [candlesJson, setCandlesJson] = useState("");
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function loadSample() {
    setCandlesJson(JSON.stringify(SAMPLE_CANDLES, null, 2));
    setMessage("تم تحميل بيانات تجريبية فقط. هذه البيانات لا تمثل بيانات سوق حقيقية.");
    setResult(null);
  }

  async function loadTestnetCandles() {
    setBusy(true);
    setMessage(null);
    setResult(null);
    try {
      const response = await fetch(
        `/api/admin/trading/exchange/testnet/market-data?symbol=${encodeURIComponent(symbol)}&interval=5m&limit=500`,
        { method: "GET", cache: "no-store" },
      );
      const data = await response.json();
      if (!response.ok) {
        setMessage(ERROR_TEXT[data.error] ?? "تعذر تحميل بيانات Binance Spot Testnet.");
        return;
      }
      setCandlesJson(JSON.stringify(withAverages(data.candles as TestnetCandle[]), null, 2));
      setMessage("تم تحميل 500 شمعة (5 دقائق) من Binance Spot Testnet. لم يتم إرسال أي أمر.");
    } catch {
      setMessage("تعذر الاتصال بـ Binance Spot Testnet.");
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    setBusy(true);
    setMessage(null);
    setResult(null);

    try {
      let candles: unknown;
      try {
        candles = JSON.parse(candlesJson);
      } catch {
        setMessage("صيغة بيانات الشموع ليست JSON صالحة.");
        return;
      }

      if (!Array.isArray(candles)) {
        setMessage("يجب أن تكون بيانات الشموع مصفوفة JSON.");
        return;
      }

      const response = await fetch("/api/admin/trading/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          candles,
          config: {
            initialCapitalUsd: numberField(initialCapitalUsd, 0),
            tradeAmountUsd: numberField(tradeAmountUsd, 0),
            stopLossPercent: numberField(stopLossPercent, 0),
            takeProfitPercent: numberField(takeProfitPercent, 0),
          },
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        setMessage(ERROR_TEXT[data.error] ?? "تعذّر تشغيل الاختبار الخلفي.");
        return;
      }

      setResult(data.result);
      setMessage("اكتمل الاختبار الخلفي. النتائج بحثية فقط ولا تنفذ أي صفقة.");
    } catch {
      setMessage("تعذّر الاتصال بخدمة الاختبار الخلفي.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <span>Backtesting</span>
        <span className="muted">بحث ومحاكاة فقط — لا أوامر حقيقية ولا تعديل للمحفظة</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginTop: 12 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span>الرمز</span>
          <input value={symbol} onChange={(event) => setSymbol(event.target.value)} disabled={busy} />
        </label>
        <label style={{ display: "grid", gap: 6 }}>
          <span>رأس المال الابتدائي USD</span>
          <input type="number" min="0.01" step="any" value={initialCapitalUsd} onChange={(event) => setInitialCapitalUsd(event.target.value)} disabled={busy} />
        </label>
        <label style={{ display: "grid", gap: 6 }}>
          <span>حجم الصفقة USD</span>
          <input type="number" min="1" step="any" value={tradeAmountUsd} onChange={(event) => setTradeAmountUsd(event.target.value)} disabled={busy} />
        </label>
        <label style={{ display: "grid", gap: 6 }}>
          <span>Stop Loss %</span>
          <input type="number" min="0.01" step="any" value={stopLossPercent} onChange={(event) => setStopLossPercent(event.target.value)} disabled={busy} />
        </label>
        <label style={{ display: "grid", gap: 6 }}>
          <span>Take Profit %</span>
          <input type="number" min="0.01" step="any" value={takeProfitPercent} onChange={(event) => setTakeProfitPercent(event.target.value)} disabled={busy} />
        </label>
      </div>

      <div style={{ display: "grid", gap: 8, marginTop: 16 }}>
        <label htmlFor="trading-backtest-candles">بيانات الشموع JSON</label>
        <textarea
          id="trading-backtest-candles"
          dir="ltr"
          value={candlesJson}
          onChange={(event) => setCandlesJson(event.target.value)}
          disabled={busy}
          rows={12}
          spellCheck={false}
          placeholder='[{"timestamp":"2026-10-01T10:00:00.000Z","open":100,"high":101,"low":99,"close":100,"volume":1000,"fastAverage":99,"slowAverage":98,"averageVolume":900}]'
          style={{ width: "100%", fontFamily: "monospace", resize: "vertical" }}
        />
        <span className="muted">الحد الأقصى 10,000 شمعة. يجب توفير المتوسطات fastAverage وslowAverage وaverageVolume التي يعتمد عليها محرك الاستراتيجية.</span>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
        <button type="button" className="btn" onClick={loadTestnetCandles} disabled={busy}>تحميل شموع Binance Testnet</button>
        <button type="button" className="btn" onClick={loadSample} disabled={busy}>تحميل بيانات تجريبية</button>
        <button type="button" className="btn" onClick={run} disabled={busy || !candlesJson.trim()}>
          {busy ? "جاري الاختبار..." : "تشغيل Backtest"}
        </button>
      </div>

      {message ? <p style={{ marginTop: 10 }}>{message}</p> : null}

      {result ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginTop: 18 }}>
            <div className={styles.statTile}><strong>${result.finalCapitalUsd.toFixed(2)}</strong><span className={styles.label}>رأس المال النهائي</span></div>
            <div className={styles.statTile}><strong>${result.pnlUsd.toFixed(2)}</strong><span className={styles.label}>P/L</span></div>
            <div className={styles.statTile}><strong>{result.returnPercent.toFixed(2)}%</strong><span className={styles.label}>العائد</span></div>
            <div className={styles.statTile}><strong>${result.maxDrawdownUsd.toFixed(2)}</strong><span className={styles.label}>أقصى سحب</span></div>
            <div className={styles.statTile}><strong>{result.totalTrades}</strong><span className={styles.label}>إجمالي الصفقات</span></div>
            <div className={styles.statTile}><strong>{result.winRatePercent.toFixed(2)}%</strong><span className={styles.label}>نسبة الفوز</span></div>
          </div>

          {result.trades.length > 0 ? (
            <div style={{ overflowX: "auto", marginTop: 16 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th>الدخول</th><th>الخروج</th><th>Entry</th><th>Exit</th><th>P/L</th><th>السبب</th>
                  </tr>
                </thead>
                <tbody>
                  {result.trades.map((trade, index) => (
                    <tr key={`${trade.entryTime}-${trade.exitTime}-${index}`}>
                      <td>{new Date(trade.entryTime).toLocaleString("ar")}</td>
                      <td>{new Date(trade.exitTime).toLocaleString("ar")}</td>
                      <td>{trade.entryPrice.toFixed(4)}</td>
                      <td>{trade.exitPrice.toFixed(4)}</td>
                      <td>{trade.pnlUsd.toFixed(4)}</td>
                      <td>{trade.exitReason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="muted" style={{ marginTop: 16 }}>لم ينتج الاختبار أي صفقات.</p>}
        </>
      ) : null}
    </section>
  );
}
