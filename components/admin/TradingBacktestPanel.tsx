"use client";

import { useState } from "react";
import styles from "../../app/admin/admin.module.css";
import TradingStrategyLabPanel from "./TradingStrategyLabPanel";

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
  totalFeesUsd?: number;
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
  PUBLIC_MARKET_DATA_INVALID_SYMBOL: "رمز غير صالح. استخدم مثل BTC/USDT أو ETH/USDT.",
  PUBLIC_MARKET_DATA_SYMBOL_NOT_FOUND: "الرمز غير موجود على Binance.",
  PUBLIC_MARKET_DATA_RATE_LIMITED: "Binance حدّت الطلبات مؤقتًا. حاول بعد دقيقة.",
  PUBLIC_MARKET_DATA_REGION_BLOCKED: "Binance تحجب الوصول من منطقة الخادم.",
  PUBLIC_MARKET_DATA_NETWORK_ERROR: "تعذر الاتصال ببيانات Binance العامة.",
  FORBIDDEN: "غير مصرح.",
  RATE_LIMITED: "تم تجاوز حد الطلبات مؤقتًا.",
};

const SAMPLE_CANDLES: Candle[] = [
  { timestamp: "2026-10-01T10:00:00.000Z", open: 100, high: 101, low: 99, close: 100, volume: 1000, fastAverage: 99, slowAverage: 98, averageVolume: 900 },
  { timestamp: "2026-10-01T10:05:00.000Z", open: 100, high: 103, low: 99.5, close: 102, volume: 1300, fastAverage: 101, slowAverage: 99, averageVolume: 1000 },
  { timestamp: "2026-10-01T10:10:00.000Z", open: 102, high: 105, low: 101, close: 104, volume: 1500, fastAverage: 103, slowAverage: 100, averageVolume: 1100 },
];

type SweepSegment = { trades: number; winRatePercent: number; returnPercent: number; maxDrawdownPercent: number };
type SweepRow = {
  fastPeriod: number;
  slowPeriod: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  train: SweepSegment;
  test: SweepSegment;
  robust: boolean;
};
type SweepResult = {
  totalCombinations: number;
  robustCount: number;
  trainCandles: number;
  testCandles: number;
  buyAndHoldTestReturnPercent: number;
  rows: SweepRow[];
};

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
  const [dataSource, setDataSource] = useState<"public" | "testnet">("public");
  const [candleInterval, setCandleInterval] = useState("1h");
  const [candleCount, setCandleCount] = useState("2000");
  const [feePercent, setFeePercent] = useState("0.1");
  const [slippagePercent, setSlippagePercent] = useState("0.05");
  const [sweep, setSweep] = useState<SweepResult | null>(null);
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
      const wanted = Math.min(Math.max(Number(candleCount) || 1000, 100), 5000);
      const byTime = new Map<string, TestnetCandle>();
      let endTime: number | null = null;

      for (let page = 0; page < 6 && byTime.size < wanted; page += 1) {
        const pageSize = Math.min(1000, wanted - byTime.size);
        const url =
          `/api/admin/trading/exchange/${dataSource}/market-data?symbol=${encodeURIComponent(symbol)}` +
          `&interval=${candleInterval}&limit=${pageSize}` +
          (endTime ? `&endTime=${endTime}` : "");
        const response = await fetch(url, { method: "GET", cache: "no-store" });
        const data = await response.json();
        if (!response.ok) {
          setMessage(ERROR_TEXT[data.error] ?? "تعذر تحميل بيانات السوق.");
          return;
        }
        const batch = data.candles as TestnetCandle[];
        if (batch.length === 0) break;
        const before = byTime.size;
        for (const candle of batch) byTime.set(candle.timestamp, candle);
        if (byTime.size === before) break;
        const oldest = Math.min(...batch.map((item) => Date.parse(item.timestamp)));
        endTime = oldest - 1;
      }

      const sorted = Array.from(byTime.values()).sort(
        (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp),
      );
      if (sorted.length === 0) {
        setMessage("لم تصل أي شموع.");
        return;
      }
      setCandlesJson(JSON.stringify(withAverages(sorted), null, 2));
      const days = (Date.parse(sorted[sorted.length - 1].timestamp) - Date.parse(sorted[0].timestamp)) / 86_400_000;
      setMessage(
        `تم تحميل ${sorted.length} شمعة (${candleInterval}) تغطي حوالي ${days.toFixed(1)} يوم من ${dataSource === "public" ? "بيانات Binance العامة (قراءة فقط)" : "Binance Spot Testnet"}. لم يتم إرسال أي أمر.`,
      );
    } catch {
      setMessage("تعذر الاتصال بـ Binance Spot Testnet.");
    } finally {
      setBusy(false);
    }
  }

  async function runSweepCompare() {
    setBusy(true);
    setMessage(null);
    setResult(null);
    setSweep(null);
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
      const response = await fetch("/api/admin/trading/backtest/sweep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          candles,
          config: {
            initialCapitalUsd: numberField(initialCapitalUsd, 0),
            tradeAmountUsd: numberField(tradeAmountUsd, 0),
            feePercent: numberField(feePercent, 0),
            slippagePercent: numberField(slippagePercent, 0),
          },
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(ERROR_TEXT[data.error] ?? "تعذّرت المقارنة. تحتاج 200 شمعة على الأقل.");
        return;
      }
      setSweep(data.result as SweepResult);
      setMessage("اكتملت المقارنة. النتائج بحثية فقط ولا تنفذ أي صفقة.");
    } catch {
      setMessage("تعذّر تشغيل المقارنة.");
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
            feePercent: numberField(feePercent, 0),
            slippagePercent: numberField(slippagePercent, 0),
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
    <>
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

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginTop: 16 }}>
        <label>
          عمولة لكل طرف %
          <input type="number" min="0" max="5" step="any" value={feePercent} onChange={(event) => setFeePercent(event.target.value)} disabled={busy} />
        </label>
        <label>
          انزلاق لكل طرف %
          <input type="number" min="0" max="5" step="any" value={slippagePercent} onChange={(event) => setSlippagePercent(event.target.value)} disabled={busy} />
        </label>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginTop: 16 }}>
        <label>
          مصدر البيانات
          <select value={dataSource} onChange={(event) => setDataSource(event.target.value as "public" | "testnet")} disabled={busy}>
            <option value="public">Binance حقيقي (عام، قراءة فقط)</option>
            <option value="testnet">Binance Testnet</option>
          </select>
        </label>
        <label>
          فاصل الشموع
          <select value={candleInterval} onChange={(event) => setCandleInterval(event.target.value)} disabled={busy}>
            <option value="5m">5 دقائق</option>
            <option value="15m">15 دقيقة</option>
            <option value="1h">ساعة</option>
            <option value="4h">4 ساعات</option>
          </select>
        </label>
        <label>
          عدد الشموع (100 – 5000)
          <input type="number" min="100" max="5000" step="100" value={candleCount} onChange={(event) => setCandleCount(event.target.value)} disabled={busy} />
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
        <button type="button" className="btn" onClick={loadTestnetCandles} disabled={busy}>تحميل الشموع</button>
        <button type="button" className="btn" onClick={loadSample} disabled={busy}>تحميل بيانات تجريبية</button>
        <button type="button" className="btn" onClick={run} disabled={busy || !candlesJson.trim()}>
          {busy ? "جاري الاختبار..." : "تشغيل Backtest"}
        </button>
        <button type="button" className="btn" onClick={runSweepCompare} disabled={busy || !candlesJson.trim()}>مقارنة الإعدادات (تدريب/اختبار)</button>
      </div>

      {message ? <p style={{ marginTop: 10 }}>{message}</p> : null}

      {sweep ? (
        <div style={{ marginTop: 18 }}>
          <p>
            {sweep.totalCombinations} مجموعة إعدادات. تدريب: {sweep.trainCandles} شمعة، اختبار: {sweep.testCandles} شمعة.
            الشراء والاحتفاظ بفترة الاختبار: {sweep.buyAndHoldTestReturnPercent.toFixed(2)}%.
            مجموعات رابحة بالفترتين: {sweep.robustCount}.
          </p>
          <p className="muted">
            الترتيب حسب فترة التدريب فقط. عمود الاختبار لم يُستخدم بالترتيب. حتى على بيانات عشوائية قد تظهر مجموعات "رابحة بالفترتين" بالصدفة،
            فلا تعتمد على النتيجة قبل تكرارها على رموز وفترات أخرى.
          </p>
          <div style={{ overflowX: "auto" }}>
            <table dir="ltr" style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th>MA</th><th>SL%</th><th>TP%</th><th>Train %</th><th>Train #</th><th>Test %</th><th>Test #</th><th>Test win%</th><th>OK</th>
                </tr>
              </thead>
              <tbody>
                {sweep.rows.map((row) => (
                  <tr key={`${row.fastPeriod}-${row.slowPeriod}-${row.stopLossPercent}-${row.takeProfitPercent}`}>
                    <td>{row.fastPeriod}/{row.slowPeriod}</td>
                    <td>{row.stopLossPercent}</td>
                    <td>{row.takeProfitPercent}</td>
                    <td>{row.train.returnPercent.toFixed(2)}</td>
                    <td>{row.train.trades}</td>
                    <td>{row.test.returnPercent.toFixed(2)}</td>
                    <td>{row.test.trades}</td>
                    <td>{row.test.winRatePercent.toFixed(0)}</td>
                    <td>{row.robust ? "✔" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {result ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginTop: 18 }}>
            <div className={styles.statTile}><strong>${result.finalCapitalUsd.toFixed(2)}</strong><span className={styles.label}>رأس المال النهائي</span></div>
            <div className={styles.statTile}><strong>${result.pnlUsd.toFixed(2)}</strong><span className={styles.label}>P/L</span></div>
            <div className={styles.statTile}><strong>{result.returnPercent.toFixed(2)}%</strong><span className={styles.label}>العائد</span></div>
            <div className={styles.statTile}><strong>${result.maxDrawdownUsd.toFixed(2)}</strong><span className={styles.label}>أقصى سحب</span></div>
            <div className={styles.statTile}><strong>{result.totalTrades}</strong><span className={styles.label}>إجمالي الصفقات</span></div>
            <div className={styles.statTile}><strong>{result.winRatePercent.toFixed(2)}%</strong><span className={styles.label}>نسبة الفوز</span></div>
            <div className={styles.statTile}><strong>${(result.totalFeesUsd ?? 0).toFixed(2)}</strong><span className={styles.label}>إجمالي العمولات</span></div>
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
    <TradingStrategyLabPanel />
    </>
  );
}
