"use client";

import { useState } from "react";
import styles from "../../app/admin/admin.module.css";

type PaperResult = {
  startingCapitalUsd: number;
  finalCapitalUsd: number;
  pnlUsd: number;
  returnPercent: number;
  trades: Array<{
    entryTime: string;
    exitTime: string;
    entryPrice: number;
    exitPrice: number;
    amountUsd: number;
    pnlUsd: number;
    exitReason: string;
    shariahPolicyVersion: string;
  }>;
  blockedSignals: Array<{ timestamp: string; reasons: string[] }>;
};

type Tick = {
  timestamp: string;
  price: number;
  previousPrice: number;
  fastAverage: number;
  slowAverage: number;
  volume: number;
  averageVolume: number;
  shariah: {
    symbol: string;
    assetType: string;
    businessActivity: string;
    tradingMethod: "SPOT";
    ownershipSettlementVerified: boolean;
  };
};

const SAMPLE_TICKS: Tick[] = [
  { timestamp: "2026-10-01T10:00:00.000Z", price: 100, previousPrice: 99, fastAverage: 99, slowAverage: 98, volume: 1000, averageVolume: 900, shariah: { symbol: "BTC/USD", assetType: "DIGITAL_ASSET", businessActivity: "spot digital asset", tradingMethod: "SPOT", ownershipSettlementVerified: true } },
  { timestamp: "2026-10-01T10:05:00.000Z", price: 102, previousPrice: 100, fastAverage: 101, slowAverage: 99, volume: 1300, averageVolume: 1000, shariah: { symbol: "BTC/USD", assetType: "DIGITAL_ASSET", businessActivity: "spot digital asset", tradingMethod: "SPOT", ownershipSettlementVerified: true } },
  { timestamp: "2026-10-01T10:10:00.000Z", price: 104, previousPrice: 102, fastAverage: 103, slowAverage: 100, volume: 1500, averageVolume: 1100, shariah: { symbol: "BTC/USD", assetType: "DIGITAL_ASSET", businessActivity: "spot digital asset", tradingMethod: "SPOT", ownershipSettlementVerified: true } },
  { timestamp: "2026-10-01T10:15:00.000Z", price: 106, previousPrice: 104, fastAverage: 105, slowAverage: 101, volume: 1600, averageVolume: 1200, shariah: { symbol: "BTC/USD", assetType: "DIGITAL_ASSET", businessActivity: "spot digital asset", tradingMethod: "SPOT", ownershipSettlementVerified: true } },
];

const ERROR_TEXT: Record<string, string> = {
  PAPER_TRADING_RISK_CONFIG_REQUIRED: "يجب تفعيل إعدادات Risk Manager أولًا.",
  INVALID_PAPER_TRADING_INPUT: "بيانات المحاكاة غير صالحة.",
  INVALID_PAPER_TRADING_CONFIG: "إعدادات المحاكاة غير صالحة.",
  INVALID_PAPER_TRADING_TICK: "إحدى نقاط السوق غير صالحة.",
  FORBIDDEN: "غير مصرح.",
  RATE_LIMITED: "تم تجاوز حد الطلبات مؤقتًا.",
};

export default function TradingPaperPanel() {
  const [symbol, setSymbol] = useState("BTC/USD");
  const [capital, setCapital] = useState("100");
  const [amount, setAmount] = useState("1");
  const [stopLoss, setStopLoss] = useState("2");
  const [takeProfit, setTakeProfit] = useState("4");
  const [ticksJson, setTicksJson] = useState("");
  const [result, setResult] = useState<PaperResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function loadSample() {
    setTicksJson(JSON.stringify(SAMPLE_TICKS, null, 2));
    setResult(null);
    setMessage("تم تحميل بيانات محاكاة فقط. لا يوجد اتصال بسوق أو أموال حقيقية.");
  }

  async function run() {
    setBusy(true);
    setResult(null);
    setMessage(null);
    try {
      let ticks: unknown;
      try { ticks = JSON.parse(ticksJson); } catch { setMessage("صيغة JSON غير صالحة."); return; }
      if (!Array.isArray(ticks)) { setMessage("يجب أن تكون نقاط السوق مصفوفة JSON."); return; }

      const response = await fetch("/api/admin/trading/paper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          startingCapitalUsd: Number(capital),
          tradeAmountUsd: Number(amount),
          stopLossPercent: Number(stopLoss),
          takeProfitPercent: Number(takeProfit),
          ticks,
        }),
      });
      const data = await response.json();
      if (!response.ok) { setMessage(ERROR_TEXT[data.error] ?? "تعذرت محاكاة التداول."); return; }
      setResult(data.result);
      setMessage("اكتملت المحاكاة. لا تمس المحفظة ولا ترسل أوامر حقيقية.");
    } catch { setMessage("تعذر الاتصال بخدمة Paper Trading."); }
    finally { setBusy(false); }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <span>Paper Trading</span>
        <span className="muted">محاكاة فقط — لا أموال حقيقية ولا Exchange API</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginTop: 12 }}>
        <label style={{ display: "grid", gap: 6 }}><span>الرمز</span><input value={symbol} onChange={(e) => setSymbol(e.target.value)} disabled={busy} /></label>
        <label style={{ display: "grid", gap: 6 }}><span>رأس المال USD</span><input type="number" min="0.01" step="any" value={capital} onChange={(e) => setCapital(e.target.value)} disabled={busy} /></label>
        <label style={{ display: "grid", gap: 6 }}><span>حجم الصفقة USD</span><input type="number" min="1" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} /></label>
        <label style={{ display: "grid", gap: 6 }}><span>Stop Loss %</span><input type="number" min="0.01" step="any" value={stopLoss} onChange={(e) => setStopLoss(e.target.value)} disabled={busy} /></label>
        <label style={{ display: "grid", gap: 6 }}><span>Take Profit %</span><input type="number" min="0.01" step="any" value={takeProfit} onChange={(e) => setTakeProfit(e.target.value)} disabled={busy} /></label>
      </div>
      <div style={{ display: "grid", gap: 8, marginTop: 16 }}>
        <label htmlFor="paper-ticks">بيانات السوق JSON</label>
        <textarea id="paper-ticks" value={ticksJson} onChange={(e) => setTicksJson(e.target.value)} disabled={busy} rows={12} spellCheck={false} style={{ width: "100%", fontFamily: "monospace", resize: "vertical" }} placeholder='[{"timestamp":"2026-10-01T10:00:00.000Z","price":100,"previousPrice":99,"fastAverage":99,"slowAverage":98,"volume":1000,"averageVolume":900,"shariah":{"symbol":"BTC/USD","assetType":"DIGITAL_ASSET","businessActivity":"spot digital asset","tradingMethod":"SPOT","ownershipSettlementVerified":true}}]' />
        <span className="muted">الحد الأقصى 10,000 نقطة. كل إشارة تمر عبر Risk Manager وShariah Guard قبل فتح مركز محاكاة.</span>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
        <button type="button" className="btn" onClick={loadSample} disabled={busy}>تحميل بيانات تجريبية</button>
        <button type="button" className="btn" onClick={run} disabled={busy || !ticksJson.trim()}>{busy ? "جاري المحاكاة..." : "تشغيل Paper Trading"}</button>
      </div>
      {message ? <p style={{ marginTop: 10 }}>{message}</p> : null}
      {result ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginTop: 18 }}>
            <div className={styles.statTile}><strong>${result.finalCapitalUsd.toFixed(2)}</strong><span className={styles.label}>الرصيد النهائي</span></div>
            <div className={styles.statTile}><strong>${result.pnlUsd.toFixed(2)}</strong><span className={styles.label}>P/L</span></div>
            <div className={styles.statTile}><strong>{result.returnPercent.toFixed(2)}%</strong><span className={styles.label}>العائد</span></div>
            <div className={styles.statTile}><strong>{result.trades.length}</strong><span className={styles.label}>صفقات محاكاة</span></div>
            <div className={styles.statTile}><strong>{result.blockedSignals.length}</strong><span className={styles.label}>إشارات محجوبة</span></div>
          </div>
          {result.blockedSignals.length > 0 ? <div style={{ marginTop: 16 }}><strong>أسباب الحجب</strong><ul>{result.blockedSignals.slice(0, 20).map((item, i) => <li key={`${item.timestamp}-${i}`}>{new Date(item.timestamp).toLocaleString("ar")} — {item.reasons.join(", ")}</li>)}</ul></div> : null}
        </>
      ) : null}
    </section>
  );
}
