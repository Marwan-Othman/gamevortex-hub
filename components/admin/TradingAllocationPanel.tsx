"use client";

import { useState } from "react";
import styles from "../../app/admin/admin.module.css";

type Allocation = {
  id: string;
  amountUsd: number;
  points: number;
  status: "ACTIVE" | "RELEASED";
  relatedTradeId: string | null;
  createdAt: string;
  releasedAt: string | null;
};

const ERROR_TEXT: Record<string, string> = {
  INSUFFICIENT_POINTS: "رصيد المحفظة غير كافٍ.",
  ALLOCATION_BELOW_MINIMUM: "الحد الأدنى للتخصيص $1.",
  ALLOCATION_ABOVE_MAXIMUM: "المبلغ أكبر من الحد الأقصى المسموح.",
  ALLOCATION_MUST_BE_WHOLE_USD: "أدخل مبلغًا صحيحًا بالدولار.",
  INVALID_ALLOCATION_AMOUNT: "مبلغ غير صالح.",
  OWNER_WALLET_NOT_FOUND: "محفظة المالك غير موجودة.",
  ALLOCATION_IN_USE: "التخصيص مرتبط بصفقة ولا يمكن إرجاعه.",
  ALLOCATION_ALREADY_RELEASED: "تم إرجاع هذا التخصيص مسبقًا.",
  FORBIDDEN: "غير مصرح.",
};

const QUICK = [1, 5, 10, 50, 100];

export default function TradingAllocationPanel({
  initialAllocations,
  pointsPerUsd,
  minUsd,
  maxUsd,
}: {
  initialAllocations: Allocation[];
  pointsPerUsd: number;
  minUsd: number;
  maxUsd: number;
}) {
  const [allocations, setAllocations] = useState(initialAllocations);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/admin/trading/allocations", { cache: "no-store" });
    if (res.ok) setAllocations((await res.json()).allocations);
  }

  async function submit() {
    const value = Number(amount);
    setMessage(null);
    if (!Number.isInteger(value) || value < minUsd || value > maxUsd) {
      setMessage(`أدخل مبلغًا صحيحًا بين $${minUsd} و $${maxUsd}.`);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/trading/allocations", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ amountUsd: value }),
      });
      const data = await res.json();
      if (!res.ok) setMessage(ERROR_TEXT[data.error] ?? "تعذّر تنفيذ العملية.");
      else {
        setMessage(`تم تخصيص $${value} (${value * pointsPerUsd} نقطة).`);
        setAmount("");
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function release(id: string) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/trading/allocations/${id}/release`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) setMessage(ERROR_TEXT[data.error] ?? "تعذّر تنفيذ العملية.");
      else {
        setMessage("تم إرجاع المبلغ إلى محفظة المالك.");
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <span>تخصيص رصيد التداول</span>
        <span className="muted">
          {pointsPerUsd} نقطة = $1 · الحد الأدنى ${minUsd} · الأقصى ${maxUsd}
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "12px 0" }}>
        {QUICK.filter((v) => v <= maxUsd).map((v) => (
          <button key={v} type="button" className="btn" disabled={busy} onClick={() => setAmount(String(v))}>
            ${v}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
          placeholder="المبلغ بالدولار"
          aria-label="المبلغ بالدولار"
        />
        <button type="button" className="btn" disabled={busy || !amount} onClick={submit}>
          تخصيص
        </button>
      </div>

      {message ? <p style={{ marginTop: 10 }}>{message}</p> : null}

      <div style={{ overflowX: "auto", marginTop: 16 }}>
        <table style={{ width: "100%" }}>
          <thead>
            <tr>
              <th>المبلغ</th>
              <th>النقاط</th>
              <th>الحالة</th>
              <th>التاريخ</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {allocations.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">لا توجد تخصيصات بعد.</td>
              </tr>
            ) : (
              allocations.map((a) => (
                <tr key={a.id}>
                  <td>${a.amountUsd}</td>
                  <td>{a.points}</td>
                  <td>{a.status === "ACTIVE" ? "نشط" : "أُرجع"}</td>
                  <td>{new Date(a.createdAt).toLocaleString("ar")}</td>
                  <td>
                    {a.status === "ACTIVE" && !a.relatedTradeId ? (
                      <button type="button" className="btn" disabled={busy} onClick={() => release(a.id)}>
                        إرجاع
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
