"use client";

import { FormEvent, useState } from "react";

type Props = { availableUsd: string; historicalAvailableUsd: string };

export default function OwnerCashReconciliation({ availableUsd, historicalAvailableUsd }: Props) {
  const [deltaUsd, setDeltaUsd] = useState("");
  const [expectedBalanceUsd, setExpectedBalanceUsd] = useState(availableUsd);
  const [reason, setReason] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setBusy(true);
    try {
      const response = await fetch("/api/admin/owner-wallet/reconcile", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ deltaUsd, expectedBalanceUsd, reason, idempotencyKey, confirm }),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string; afterUsd?: string };
      if (!response.ok) throw new Error(data.error || "RECONCILIATION_FAILED");
      setMessage("تمت التسوية. الرصيد النقدي الجديد: $" + data.afterUsd);
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "RECONCILIATION_FAILED");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="glass card" style={{ marginTop: 18 }}>
      <h2>تسوية النقد USD</h2>
      <p className="muted">تعديل النقد USD الفعلي فقط بعد مطابقة السجل المالي الخارجي. لا يتم تحويل نقاط المالك إلى نقد تلقائيًا.</p>
      <p className="muted">الرصيد الحالي: <strong>${availableUsd}</strong> · الصافي التاريخي المحسوب غير المسوّى: <strong>${historicalAvailableUsd}</strong></p>
      <form onSubmit={submit} style={{ display: "grid", gap: 10 }}>
        <label>مقدار التعديل USD (+ للإضافة، - للتخفيض)<input value={deltaUsd} onChange={(e) => setDeltaUsd(e.target.value)} inputMode="decimal" required /></label>
        <label>الرصيد الحالي المتوقع<input value={expectedBalanceUsd} onChange={(e) => setExpectedBalanceUsd(e.target.value)} inputMode="decimal" required /></label>
        <label>سبب التسوية<textarea value={reason} onChange={(e) => setReason(e.target.value)} minLength={10} maxLength={500} required /></label>
        <label>مفتاح العملية الفريد<input value={idempotencyKey} onChange={(e) => setIdempotencyKey(e.target.value)} minLength={8} maxLength={200} required /></label>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /> أؤكد أن المبلغ تمت مطابقته خارج النظام.</label>
        <button type="submit" disabled={busy || !confirm}>{busy ? "جارٍ التنفيذ..." : "تنفيذ التسوية"}</button>
        {message ? <p role="status">{message}</p> : null}
      </form>
    </section>
  );
}