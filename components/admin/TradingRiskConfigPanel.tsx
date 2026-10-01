"use client";

import { useState } from "react";
import styles from "../../app/admin/admin.module.css";

type RiskConfig = {
  maxTradeAmountUsd: number;
  maxDailyLossUsd: number;
  maxOpenTrades: number;
  maxExposureUsd: number;
  maxExposurePerAssetUsd: number;
  maxConsecutiveLosses: number;
  requireStopLoss: boolean;
  requireTakeProfit: boolean;
};

type Props = {
  initial: { config: RiskConfig; enabled: boolean; updatedAt: string } | null;
};

const ERROR_TEXT: Record<string, string> = {
  INVALID_RISK_CONFIG: "إعدادات المخاطر غير صالحة.",
  FORBIDDEN: "غير مصرح.",
};

function normalize(initial: Props["initial"]): RiskConfig {
  return (
    initial?.config ?? {
      maxTradeAmountUsd: 1,
      maxDailyLossUsd: 1,
      maxOpenTrades: 1,
      maxExposureUsd: 1,
      maxExposurePerAssetUsd: 1,
      maxConsecutiveLosses: 1,
      requireStopLoss: true,
      requireTakeProfit: false,
    }
  );
}

export default function TradingRiskConfigPanel({ initial }: Props) {
  const [config, setConfig] = useState<RiskConfig>(normalize(initial));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function setNumber(field: keyof RiskConfig, value: string) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      setConfig((current) => ({ ...current, [field]: parsed }));
    }
  }

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/trading/risk-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(ERROR_TEXT[data.error] ?? "تعذّر حفظ إعدادات المخاطر.");
        return;
      }
      setConfig(data.riskConfig.config);
      setMessage("تم حفظ إعدادات المخاطر وتسجيل التغيير في سجل التدقيق.");
    } catch {
      setMessage("تعذّر الاتصال بخدمة إعدادات المخاطر.");
    } finally {
      setBusy(false);
    }
  }

  const fields: Array<[keyof RiskConfig, string, string]> = [
    ["maxTradeAmountUsd", "أقصى مبلغ للصفقة", "USD"],
    ["maxDailyLossUsd", "أقصى خسارة يومية", "USD"],
    ["maxOpenTrades", "أقصى عدد صفقات مفتوحة", "صفقة"],
    ["maxExposureUsd", "أقصى تعرض إجمالي", "USD"],
    ["maxExposurePerAssetUsd", "أقصى تعرض للأصل الواحد", "USD"],
    ["maxConsecutiveLosses", "أقصى خسائر متتالية", "مرة"],
  ];

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <span>Risk Manager</span>
        <span className="muted">حواجز إلزامية قبل أي تنفيذ مستقبلي</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginTop: 12 }}>
        {fields.map(([field, label, suffix]) => (
          <label key={field} style={{ display: "grid", gap: 6 }}>
            <span>{label}</span>
            <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="number"
                min={field === "maxDailyLossUsd" || field === "maxExposureUsd" || field === "maxExposurePerAssetUsd" ? 0 : 1}
                step="any"
                value={config[field] as number}
                onChange={(event) => setNumber(field, event.target.value)}
                disabled={busy}
              />
              <span className="muted">{suffix}</span>
            </span>
          </label>
        ))}
      </div>

      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 16 }}>
        <label>
          <input
            type="checkbox"
            checked={config.requireStopLoss}
            onChange={(event) => setConfig((current) => ({ ...current, requireStopLoss: event.target.checked }))}
            disabled={busy}
          />{" "}
          Stop Loss إجباري
        </label>
        <label>
          <input
            type="checkbox"
            checked={config.requireTakeProfit}
            onChange={(event) => setConfig((current) => ({ ...current, requireTakeProfit: event.target.checked }))}
            disabled={busy}
          />{" "}
          Take Profit إجباري
        </label>
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 16, flexWrap: "wrap" }}>
        <button type="button" className="btn" onClick={save} disabled={busy}>
          {busy ? "جاري الحفظ..." : "حفظ إعدادات المخاطر"}
        </button>
        {initial ? <span className="muted">آخر تحديث: {new Date(initial.updatedAt).toLocaleString("ar")}</span> : <span className="muted">لم يتم حفظ إعدادات بعد</span>}
      </div>

      {message ? <p style={{ marginTop: 10 }}>{message}</p> : null}
    </section>
  );
}
