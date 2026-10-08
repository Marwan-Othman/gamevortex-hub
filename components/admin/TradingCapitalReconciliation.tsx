"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "../../app/admin/admin.module.css";

type Reconciliation = {
  internal: {
    ownerWalletAvailableUsd: string;
    tradingAccountBalanceUsd: string;
    activeAllocationsUsd: string;
    openTradeExposureUsd: string;
  };
  binance: {
    usdtFreeUsd: string;
    usdtLockedUsd: string;
    usdtTotalUsd: string;
  };
  comparison: { balanceDeltaUsd: string | null; status: string; custodyVerified: false };
  generatedAt: string;
};

const STATUS_TEXT: Record<string, string> = {
  NOT_CONFIGURED: "مفاتيح Binance غير مهيأة",
  PROVIDER_UNAVAILABLE: "تعذر الوصول إلى Binance",
  NO_INTERNAL_CAPITAL: "لا يوجد رأس مال داخلي",
  MISMATCH: "يوجد اختلاف",
  BALANCE_MATCH_CUSTODY_UNVERIFIED: "الأرقام متطابقة، لكن مصدر الأموال غير مثبت",
};

export default function TradingCapitalReconciliation() {
  const [data, setData] = useState<Reconciliation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/trading/capital-reconciliation", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error || "تعذر قراءة reconciliation");
        return;
      }
      setData(payload.reconciliation);
    } catch {
      setError("تعذر الاتصال بخدمة reconciliation.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <span>Capital Reconciliation</span>
        <span className="muted">قراءة فقط</span>
      </div>
      <p className="muted" style={{ marginTop: 10 }}>
        مقارنة السجل الداخلي مع Binance. لا تعدّل هذه الشاشة أي رصيد، ولا تعتبر تطابق الأرقام إثباتًا لتحويل الأموال.
      </p>
      <button type="button" className="btn" onClick={load} disabled={busy}>
        {busy ? "جاري الفحص..." : "فحص الآن"}
      </button>
      {error ? <p style={{ marginTop: 12 }}>{error}</p> : null}
      {data ? (
        <>
          <div className={styles.statGrid} style={{ marginTop: 16 }}>
            <div className={styles.statTile}><strong>{"$"}{data.internal.ownerWalletAvailableUsd}</strong><span className={styles.label}>Owner Wallet USD</span></div>
            <div className={styles.statTile}><strong>{"$"}{data.internal.tradingAccountBalanceUsd}</strong><span className={styles.label}>Trading Account</span></div>
            <div className={styles.statTile}><strong>{"$"}{data.internal.activeAllocationsUsd}</strong><span className={styles.label}>Active Allocations</span></div>
            <div className={styles.statTile}><strong>{"$"}{data.internal.openTradeExposureUsd}</strong><span className={styles.label}>Open Trade Exposure</span></div>
            <div className={styles.statTile}><strong>{"$"}{data.binance.usdtFreeUsd}</strong><span className={styles.label}>Binance Free USDT</span></div>
            <div className={styles.statTile}><strong>{"$"}{data.binance.usdtLockedUsd}</strong><span className={styles.label}>Binance Locked USDT</span></div>
          </div>
          <div style={{ marginTop: 16, display: "grid", gap: 6 }}>
            <strong>الحالة: {STATUS_TEXT[data.comparison.status] ?? data.comparison.status}</strong>
            <span className="muted">Binance Total: {"$"}{data.binance.usdtTotalUsd}</span>
            <span className="muted">Delta: {data.comparison.balanceDeltaUsd === null ? "غير متاح" : "$" + data.comparison.balanceDeltaUsd}</span>
            <span className="muted">Custody verified: لا</span>
            <span className="muted" dir="ltr">Checked: {new Date(data.generatedAt).toLocaleString("ar")}</span>
          </div>
        </>
      ) : null}
    </section>
  );
}
