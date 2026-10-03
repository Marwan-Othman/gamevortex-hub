"use client";

import { useState } from "react";
import styles from "../../app/admin/admin.module.css";

type Preflight = {
  credentialsConfigured: boolean;
  endpoint: string;
  readyForLiveExecution: boolean;
  blockers: string[];
  checks: Record<string, boolean>;
  account?: { accountType: string; permissions: string[] };
};

const CHECK_TEXT: Record<string, string> = {
  credentials: "مفاتيح الإنتاج موجودة على الخادم",
  spotAccount: "الحساب Spot وصلاحية SPOT موجودة",
  tradingEnabled: "التداول Spot مفعّل للمفتاح",
  withdrawalsDisabled: "السحب معطّل للمفتاح",
  spotTradingOnly: "التداول محصور في Spot بدون Margin/Futures/Options/Portfolio Margin",
  marginDisabled: "Margin معطّل",
  futuresDisabled: "Futures معطّل",
  optionsDisabled: "Options معطّل",
  portfolioMarginDisabled: "Portfolio Margin معطّل",
  internalTransferDisabled: "Internal Transfer معطّل",
  liveFlagEnabled: "مفتاح تفعيل التداول الحقيقي مفعّل",
};

const BLOCKER_TEXT: Record<string, string> = {
  BINANCE_LIVE_API_CREDENTIALS_REQUIRED: "مفاتيح Binance للإنتاج غير مضافة بعد.",
  BINANCE_LIVE_RESTRICTED_LOCATION: "Binance رفضت اتصال خادم الإنتاج بسبب قيد موقع/أهلية الخدمة. لا يمكن تفعيل التداول الحقيقي من هذا الاتصال ولا ينبغي تجاوز القيد عبر VPN أو تغيير عنوان IP.",
  BINANCE_LIVE_SPOT_ACCOUNT_REQUIRED: "يجب أن يكون الحساب Spot وأن تظهر صلاحية SPOT.",
  BINANCE_LIVE_SPOT_TRADING_REQUIRED: "يجب تفعيل Spot Trading للمفتاح.",
  BINANCE_LIVE_WITHDRAWALS_MUST_BE_DISABLED: "السحب مفعّل على المفتاح؛ يجب تعطيله قبل أي تداول حقيقي.",
  BINANCE_LIVE_MARGIN_MUST_BE_DISABLED: "Margin مفعّل؛ يجب تعطيله.",
  BINANCE_LIVE_FUTURES_MUST_BE_DISABLED: "Futures مفعّل؛ يجب تعطيله.",
  BINANCE_LIVE_OPTIONS_MUST_BE_DISABLED: "Options مفعّل؛ يجب تعطيله.",
  BINANCE_LIVE_PORTFOLIO_MARGIN_MUST_BE_DISABLED: "Portfolio Margin مفعّل؛ يجب تعطيله.",
  BINANCE_LIVE_INTERNAL_TRANSFER_MUST_BE_DISABLED: "Internal Transfer مفعّل؛ يجب تعطيله لهذه المرحلة.",
  GAMEVORTEX_LIVE_TRADING_DISABLED: "التفعيل البرمجي للتداول الحقيقي ما زال مغلقًا عمدًا.",
};

export default function TradingLivePreflightPanel() {
  const [data, setData] = useState<Preflight | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function check() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/trading/exchange/live/preflight", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) {
        setData(null);
        setMessage(BLOCKER_TEXT[payload.error] ?? "تعذر فحص جاهزية Binance للإنتاج.");
        return;
      }
      setData(payload as Preflight);
    } catch {
      setData(null);
      setMessage("تعذر الاتصال بخدمة فحص Binance للإنتاج.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <span>Live Trading Preflight</span>
        <span className="muted">فحص قراءة فقط — لا يرسل أي أمر ولا يسحب أموالًا</span>
      </div>
      <p className="muted" style={{ marginTop: 10 }}>
        هذه الخطوة تتحقق من حساب Binance الإنتاجي وصلاحيات مفتاح API فقط. وجود مفتاح صحيح لا يعني أن النظام سيسمح بالتداول الحقيقي.
      </p>
      <button type="button" className="btn" onClick={check} disabled={busy}>
        {busy ? "جاري الفحص..." : "فحص جاهزية Binance للإنتاج"}
      </button>
      {message ? <p style={{ marginTop: 10 }}>{message}</p> : null}
      {data ? (
        <>
          <div style={{ marginTop: 14 }}>
            <strong>{data.readyForLiveExecution ? "جاهزية تقنية مبدئية" : "التداول الحقيقي غير جاهز"}</strong>
            <p className="muted">Endpoint: {data.endpoint}</p>
          </div>
          <div style={{ display: "grid", gap: 6, marginTop: 12 }}>
            {Object.entries(data.checks).map(([key, value]) => (
              <div key={key} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span>{CHECK_TEXT[key] ?? key}</span>
                <strong>{value ? "PASS" : "BLOCK"}</strong>
              </div>
            ))}
          </div>
          {data.account ? <p className="muted" style={{ marginTop: 12 }}>نوع الحساب: {data.account.accountType} — صلاحيات الحساب: {data.account.permissions.join(", ") || "لا توجد"}</p> : null}
          {data.blockers.length > 0 ? (
            <div style={{ marginTop: 12 }}>
              <strong>العوائق الحالية</strong>
              <ul>{data.blockers.map((blocker) => <li key={blocker}>{BLOCKER_TEXT[blocker] ?? blocker}</li>)}</ul>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
