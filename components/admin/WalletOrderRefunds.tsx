"use client";

import { useState } from "react";

type WalletOrder = {
  id: string;
  userLabel: string;
  totalCents: number;
  currency: string;
  status: string;
  createdAt: string;
};

export default function WalletOrderRefunds({
  orders,
}: {
  orders: WalletOrder[];
}) {
  const [items, setItems] = useState(orders);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function refund(orderId: string) {
    if (!window.confirm("هل تريد فعلًا استرداد قيمة هذا الطلب إلى محفظة المستخدم؟")) {
      return;
    }

    setBusyId(orderId);
    setMessage(null);

    try {
      const response = await fetch(`/api/admin/orders/${orderId}/wallet-refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          typeof data?.error === "string" ? data.error : "WALLET_REFUND_FAILED",
        );
      }

      setItems((current) =>
        current.map((item) =>
          item.id === orderId ? { ...item, status: "REFUNDED" } : item,
        ),
      );
      setMessage("تم تنفيذ الاسترداد وتسجيل العملية.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "فشل الاسترداد.");
    } finally {
      setBusyId(null);
    }
  }

  if (!items.length) {
    return (
      <section className="glass card" style={{ marginTop: 18 }}>
        <h2>استرداد مشتريات المحفظة</h2>
        <p className="muted">لا توجد عمليات شراء من المحفظة في آخر الطلبات.</p>
      </section>
    );
  }

  return (
    <section className="glass card" style={{ marginTop: 18 }}>
      <div className="panel-head">
        <div>
          <h2>استرداد مشتريات المحفظة</h2>
          <p className="muted">
            الاسترداد يعيد المال إلى محفظة المستخدم، ويلغي التسليم ويسجل قيود المحاسبة والتدقيق.
          </p>
        </div>
      </div>

      {message && (
        <p className="muted" role="status" style={{ marginBottom: 12 }}>
          {message}
        </p>
      )}

      <div style={{ display: "grid", gap: 10 }}>
        {items.map((order) => (
          <div
            key={order.id}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
              padding: 12,
              border: "1px solid rgba(255,255,255,.08)",
              borderRadius: 12,
            }}
          >
            <div>
              <strong>{order.userLabel}</strong>
              <div className="muted">
                {order.id.slice(0, 12)} ·{" "}
                {(order.totalCents / 100).toFixed(2)} {order.currency} ·{" "}
                {new Date(order.createdAt).toLocaleString("ar")}
              </div>
            </div>

            {order.status === "REFUNDED" ? (
              <span className="badge">تم الاسترداد</span>
            ) : (
              <button
                type="button"
                className="btn secondary"
                disabled={busyId === order.id}
                onClick={() => refund(order.id)}
              >
                {busyId === order.id ? "جارٍ الاسترداد..." : "استرداد إلى المحفظة"}
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
