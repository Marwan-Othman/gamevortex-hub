"use client";

import { useState } from "react";
import styles from "../../app/admin/admin.module.css";

type Segment = { trades: number; winRatePercent: number; returnPercent: number; maxDrawdownPercent: number; exposurePercent: number };
type Row = {
  id: string;
  family: string;
  label: string;
  avgTrainReturn: number;
  avgTestReturn: number;
  trainPositiveSymbols: number;
  testPositiveSymbols: number;
  minTrades: number;
  robust: boolean;
  perSymbol: { symbol: string; train: Segment; test: Segment }[];
};
type Benchmark = { symbol: string; trainReturnPercent: number; testReturnPercent: number; testMaxDrawdownPercent: number };
type LabResult = {
  totalCombinations: number;
  robustCount: number;
  trainCandles: number;
  testCandles: number;
  benchmarks: Benchmark[];
  rows: Row[];
  bestPerFamily: Row[];
};

const ERRORS: Record<string, string> = {
  PUBLIC_MARKET_DATA_REGION_BLOCKED: "Binance تحجب الوصول من منطقة الخادم.",
  PUBLIC_MARKET_DATA_RATE_LIMITED: "Binance حدّت الطلبات مؤقتًا. حاول بعد دقيقة.",
  PUBLIC_MARKET_DATA_NETWORK_ERROR: "تعذر الاتصال ببيانات Binance العامة.",
  PUBLIC_MARKET_DATA_SYMBOL_NOT_FOUND: "أحد الرموز غير موجود على Binance.",
  INVALID_BACKTEST_CONFIG: "الإعدادات غير صالحة. حجم الصفقة بين 1$ ورأس المال.",
  FORBIDDEN: "غير مصرح.",
  RATE_LIMITED: "تم تجاوز حد الطلبات مؤقتًا.",
};

const FAMILY_LABEL: Record<string, string> = { MA_TREND: "متوسطات", BREAKOUT: "اختراق", RSI_DIP: "RSI" };

function num(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default function TradingStrategyLabPanel() {
  const [symbols, setSymbols] = useState("BTC/USDT, ETH/USDT, SOL/USDT");
  const [interval, setIntervalValue] = useState("1h");
  const [candles, setCandles] = useState("5000");
  const [capital, setCapital] = useState("100");
  const [tradeAmount, setTradeAmount] = useState("10");
  const [fee, setFee] = useState("0.1");
  const [slippage, setSlippage] = useState("0.05");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<LabResult | null>(null);

  async function run() {
    setBusy(true);
    setMessage("جاري تحميل البيانات وتشغيل 90 مجموعة... قد يستغرق حتى دقيقة.");
    setResult(null);
    try {
      const response = await fetch("/api/admin/trading/backtest/lab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbols: symbols.split(",").map((s) => s.trim()).filter(Boolean),
          interval,
          candles: num(candles, 5000),
          initialCapitalUsd: num(capital, 100),
          tradeAmountUsd: num(tradeAmount, 10),
          feePercent: num(fee, 0.1),
          slippagePercent: num(slippage, 0.05),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(ERRORS[data.error] ?? "تعذّر تشغيل مختبر الاستراتيجيات.");
        return;
      }
      setResult(data.result as LabResult);
      setMessage("اكتمل المختبر. النتائج بحثية فقط ولا تنفذ أي صفقة.");
    } catch {
      setMessage("تعذّر الاتصال بالخادم.");
    } finally {
      setBusy(false);
    }
  }

  const verdict = result
    ? result.robustCount === 0
      ? "لا توجد أي مجموعة ربحت بشكل متسق بالتدريب والاختبار على أغلب الرموز. لا يوجد دليل على أفضلية. لا تنتقل للتداول الحقيقي بهذه الاستراتيجيات."
      : `وُجدت ${result.robustCount} مجموعة من ${result.totalCombinations} رابحة بالفترتين على أغلب الرموز. مع هذا العدد من التجارب قد يكون جزء منها صدفة. لا تعتبرها دليلاً قبل Paper Trading لعدة أسابيع.`
    : null;

  return (
    <section className={styles.panel} style={{ marginTop: 20 }}>
      <h3>مختبر الاستراتيجيات</h3>
      <p className="muted">يقارن 90 مجموعة (متوسطات، اختراق، RSI) على عدة رموز مع عمولة وانزلاق وخروج حسب ATR. بيانات Binance العامة، قراءة فقط.</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginTop: 12 }}>
        <label>الرموز (حتى 4)<input dir="ltr" value={symbols} onChange={(e) => setSymbols(e.target.value)} disabled={busy} /></label>
        <label>الفاصل
          <select value={interval} onChange={(e) => setIntervalValue(e.target.value)} disabled={busy}>
            <option value="15m">15 دقيقة</option>
            <option value="1h">ساعة</option>
            <option value="4h">4 ساعات</option>
          </select>
        </label>
        <label>عدد الشموع (1000–5000)<input type="number" min="1000" max="5000" step="500" value={candles} onChange={(e) => setCandles(e.target.value)} disabled={busy} /></label>
        <label>رأس المال $<input type="number" min="1" step="any" value={capital} onChange={(e) => setCapital(e.target.value)} disabled={busy} /></label>
        <label>حجم الصفقة $<input type="number" min="1" step="any" value={tradeAmount} onChange={(e) => setTradeAmount(e.target.value)} disabled={busy} /></label>
        <label>عمولة % لكل طرف<input type="number" min="0" max="5" step="any" value={fee} onChange={(e) => setFee(e.target.value)} disabled={busy} /></label>
        <label>انزلاق % لكل طرف<input type="number" min="0" max="5" step="any" value={slippage} onChange={(e) => setSlippage(e.target.value)} disabled={busy} /></label>
      </div>

      <div style={{ marginTop: 12 }}>
        <button type="button" className="btn" onClick={run} disabled={busy}>{busy ? "جاري التشغيل..." : "شغّل المختبر"}</button>
      </div>
      {message ? <p style={{ marginTop: 10 }}>{message}</p> : null}

      {result ? (
        <div style={{ marginTop: 16 }}>
          <p><strong>{verdict}</strong></p>
          <p className="muted">
            تدريب: {result.trainCandles} شمعة، اختبار: {result.testCandles} شمعة. الترتيب حسب التدريب فقط.
            "OK" = ربح بالتدريب والاختبار على رمزين على الأقل وبحد أدنى 5 صفقات بكل فترة.
          </p>

          <h4>الشراء والاحتفاظ (للمقارنة)</h4>
          <div style={{ overflowX: "auto" }}>
            <table dir="ltr" style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th>Symbol</th><th>Train %</th><th>Test %</th><th>Test max DD %</th></tr></thead>
              <tbody>
                {result.benchmarks.map((b) => (
                  <tr key={b.symbol}>
                    <td>{b.symbol}</td><td>{b.trainReturnPercent.toFixed(1)}</td><td>{b.testReturnPercent.toFixed(1)}</td><td>{b.testMaxDrawdownPercent.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h4 style={{ marginTop: 16 }}>أفضل 10 (حسب التدريب)</h4>
          <div style={{ overflowX: "auto" }}>
            <table dir="ltr" style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr><th>Strategy</th><th>Train avg %</th><th>Test avg %</th><th>Train +</th><th>Test +</th><th>Min #</th><th>OK</th></tr>
              </thead>
              <tbody>
                {result.rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.label}</td>
                    <td>{row.avgTrainReturn.toFixed(2)}</td>
                    <td>{row.avgTestReturn.toFixed(2)}</td>
                    <td>{row.trainPositiveSymbols}</td>
                    <td>{row.testPositiveSymbols}</td>
                    <td>{row.minTrades}</td>
                    <td>{row.robust ? "✔" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h4 style={{ marginTop: 16 }}>أفضل مجموعة بكل عائلة</h4>
          <div style={{ overflowX: "auto" }}>
            <table dir="ltr" style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr><th>Family</th><th>Strategy</th><th>Train %</th><th>Test %</th><th>Test exposure %</th></tr></thead>
              <tbody>
                {result.bestPerFamily.map((row) => {
                  const exposure = row.perSymbol.reduce((s, r) => s + r.test.exposurePercent, 0) / row.perSymbol.length;
                  return (
                    <tr key={row.id}>
                      <td>{FAMILY_LABEL[row.family] ?? row.family}</td><td>{row.label}</td>
                      <td>{row.avgTrainReturn.toFixed(2)}</td><td>{row.avgTestReturn.toFixed(2)}</td><td>{exposure.toFixed(0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
