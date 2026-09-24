"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Item = {
  id: string;
  title: string;
  priceCents: number;
  currency: string;
  active: boolean;
  inventory: number | null;
};

export default function ImportedGiftCards({ products }: { products: Item[] }) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>(products);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  async function setActive(ids: string[], active: boolean) {
    if (!ids.length) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const response = await fetch("/api/admin/fazercards/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds: ids, active }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        setMessage(`فشل التحديث: ${data.error || response.status}`);
        return;
      }
      setItems((current) =>
        current.map((item) => (ids.includes(item.id) ? { ...item, active } : item)),
      );
      setMessage(active ? "تم التفعيل، والبطاقات صارت تظهر في صفحة البطاقات." : "تم التعطيل.");
      router.refresh();
    } catch {
      setMessage("تعذر الاتصال بالخادم.");
    } finally {
      setBusy(false);
    }
  }

  const inactiveIds = items.filter((item) => !item.active).map((item) => item.id);
  const activeIds = items.filter((item) => item.active).map((item) => item.id);

  return (
    <section style={{ display: "grid", gap: 12 }}>
      {items.length > 0 && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            className="btn"
            type="button"
            disabled={busy || !inactiveIds.length}
            onClick={() => setActive(inactiveIds, true)}
          >
            تفعيل الكل ({inactiveIds.length})
          </button>
          <button
            className="btn secondary"
            type="button"
            disabled={busy || !activeIds.length}
            onClick={() => setActive(activeIds, false)}
          >
            تعطيل الكل ({activeIds.length})
          </button>
        </div>
      )}

      {message && (
        <p className="muted" role="status" aria-live="polite">
          {message}
        </p>
      )}

      <div className="grid">
        {items.map((item) => (
          <article className="card product" key={item.id}>
            <div className="product-meta">
              <span className="pill">{item.active ? "مفعّل" : "غير مفعّل"}</span>
              {item.inventory !== null && <span className="pill">مخزون: {item.inventory}</span>}
            </div>
            <h3 style={{ margin: 0 }}>{item.title}</h3>
            <div className="product-price">
              {(item.priceCents / 100).toFixed(2)} {item.currency}
            </div>
            <button
              className={item.active ? "btn secondary" : "btn"}
              type="button"
              disabled={busy}
              onClick={() => setActive([item.id], !item.active)}
            >
              {item.active ? "تعطيل" : "تفعيل"}
            </button>
          </article>
        ))}
        {!items.length && <p className="muted">لم يتم استيراد أي بطاقة بعد.</p>}
      </div>
    </section>
  );
}
