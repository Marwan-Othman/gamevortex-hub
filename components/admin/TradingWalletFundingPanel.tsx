"use client";

import { useEffect, useState } from "react";
import styles from "../../app/admin/admin.module.css";

type Balances = {
  sourceWalletAvailableUsd: string;
  sourceWalletPendingUsd: string;
  ownerWalletAvailableUsd: string;
  sourceCurrencyVerified: boolean;
  sourceCurrencyBlocker: string | null;
};

const ERRORS: Record<string, string> = {
  FORBIDDEN: "هذه العملية متاحة للمالك فقط.",
  SOURCE_WALLET_NOT_FOUND: "لم يتم العثور على المحفظة المالية.",
  INSUFFICIENT_WALLET_BALANCE: "الرصيد النقدي المتاح غير كافٍ. الرصيد المعلّق لا يمكن استخدامه.",
  IDEMPOTENCY_KEY_REQUIRED: "تعذّر تأكيد الطلب. حدّث الصفحة وحاول مرة واحدة.",
  IDEMPOTENCY_KEY_CONFLICT: "تعارض في معرّف العملية. حدّث الصفحة قبل المحاولة.",
  INVALID_FUNDING_AMOUNT: "اختر مبلغًا صحيحًا بين 1 و1000 دولار.",
  TRADING_WALLET_FUNDING_FAILED: "فشل التحويل الداخلي. لم يتم تأكيد نجاحه؛ افحص الأرصدة قبل إعادة المحاولة.",
  FUNDING_BALANCE_READ_FAILED: "تعذّر قراءة الأرصدة من الخادم.",
  TRADING_FUNDING_SOURCE_CURRENCY_NOT_VERIFIED: "تم إيقاف التحويل: سجل المحفظة يحتوي عملات غير الدولار ولم تتم مطابقتها أو تحويلها بسجل موثّق. لن نعتبر الرصيد دولارًا دون تحقق.",
};

function usd(value: string | number | undefined) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number.toFixed(2) : "0.00";
}

export default function TradingWalletFundingPanel() {
  const [balances, setBalances] = useState<Balances | null>(null);
  const [amount, setAmount] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [pendingOperation, setPendingOperation] = useState<{ key: string; amount: number } | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/trading/wallet-funding", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "FUNDING_BALANCE_READ_FAILED");
      setBalances(data);
    } catch (cause) {
      setError(true);
      setMessage(ERRORS[cause instanceof Error ? cause.message : ""] || "تعذّرت قراءة الأرصدة.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  async function transfer() {
    if (busy || amount < 1 || amount > 1000) return;
    const confirmed = window.confirm(`تأكيد نقل ${amount.toFixed(2)} من المحفظة المالية إلى محفظة المالك؟ لن تُرسل الأموال إلى Binance ولن تُنفّذ صفقة.`);
    if (!confirmed) return;
    const operation = pendingOperation?.amount === amount
      ? pendingOperation
      : { key: crypto.randomUUID(), amount };
    setPendingOperation(operation);
    setBusy(true);
    setMessage(null);
    setError(false);
    try {
      const response = await fetch("/api/admin/trading/wallet-funding", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": operation.key,
        },
        body: JSON.stringify({ amountUsd: amount }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "TRADING_WALLET_FUNDING_FAILED");
      setBalances({
        sourceWalletAvailableUsd: data.sourceWalletAvailableUsd,
        sourceWalletPendingUsd: balances?.sourceWalletPendingUsd ?? "0.00",
        ownerWalletAvailableUsd: data.ownerWalletAvailableUsd,
        sourceCurrencyVerified: data.sourceCurrencyVerified === true,
        sourceCurrencyBlocker: data.sourceCurrencyBlocker ?? null,
      });
      setPendingOperation(null);
      setMessage(data.replayed
        ? "تم التحقق من العملية السابقة؛ لم يُخصم المبلغ مرة أخرى."
        : `تم نقل ${amount.toFixed(2)} داخليًا إلى محفظة المالك. لم تُرسل أموال إلى Binance ولم تُنفّذ صفقة.`);
    } catch (cause) {
      setError(true);
      setMessage(ERRORS[cause instanceof Error ? cause.message : ""] || "تعذّر إتمام التحويل الداخلي.");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="trading-wallet-funding-title">
      <div className={styles.panelHead}>
        <span id="trading-wallet-funding-title">تمويل محفظة المالك من المحفظة المالية</span>
        <span className="muted">تحويل داخلي فقط</span>
      </div>
      <p className="muted">
        هذا الإجراء ينقل رصيدًا متاحًا من محفظة الموقع إلى محفظة المالك التي يعتمد عليها تخصيص التداول. لا يسحب أموالًا من Binance ولا ينفّذ أي صفقة. الرصيد المعلّق غير قابل للتحويل.
      </p>
      {balances && !balances.sourceCurrencyVerified ? (
        <p role="alert" className="muted">
          لا يمكن اعتبار الرصيد المعروض دولارًا صالحًا للتداول: توجد سجلات بعملات غير USD. يلزم تدقيق التحويلات التاريخية ومطابقتها قبل إتاحة التحويل الداخلي.
        </p>
      ) : null}
      <div className={styles.statGrid} aria-live="polite">
        <div className={styles.statTile}>
          <strong>{loading ? "…" : `$${usd(balances?.sourceWalletAvailableUsd)}`}</strong>
          <span className={styles.label}>المتاح في المحفظة المالية</span>
        </div>
        <div className={styles.statTile}>
          <strong>{loading ? "…" : `$${usd(balances?.ownerWalletAvailableUsd)}`}</strong>
          <span className={styles.label}>المتاح في محفظة المالك</span>
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "12px 0" }}>
        {[1, 5, 10, 50, 100].map((value) => (
          <button key={value} type="button" className="btn" disabled={busy || loading} aria-pressed={amount === value} onClick={() => setAmount(value)}>
            ${value}
          </button>
        ))}
      </div>
      <p className="muted">المبلغ المحدد للتحويل: <strong>${amount.toFixed(2)}</strong></p>
      <button
        type="button"
        className="btn"
        disabled={busy || loading || !balances || !balances.sourceCurrencyVerified || Number(balances.sourceWalletAvailableUsd) < amount}
        onClick={() => void transfer()}
      >
        {busy ? "جارٍ تسجيل التحويل…" : `نقل $${amount.toFixed(2)} إلى محفظة المالك`}
      </button>
      {message ? <p role="status" style={{ marginTop: 10, overflowWrap: "anywhere" }} className={error ? "muted" : undefined}>{message}</p> : null}
      {balances && Number(balances.sourceWalletAvailableUsd) < 1 ? <p className="muted">لا يوجد دولار متاح للتحويل. إذا كان الرصيد ظاهرًا في صفحة أخرى، لا تكرر الدفع؛ نحتاج مراجعة حالة التسوية ومصدر الرصيد.</p> : null}
      <button type="button" className="btn" style={{ marginInlineStart: 8, marginTop: 8 }} disabled={busy || loading} onClick={() => void refresh()}>
        تحديث الأرصدة
      </button>
    </section>
  );
}
