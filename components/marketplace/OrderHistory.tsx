"use client";

import { useEffect, useState } from "react";

type OrderItem = {
  id: string;
  quantity: number;
  unitPriceCents: number;
  product: { title: string };
};

type Order = {
  id: string;
  status: string;
  paymentStatus: string;
  totalCents: number;
  currency: string;
  createdAt: string;
  items: OrderItem[];
};

type DeliveredKey = {
  id: string;
  code: string;
  deliveredAt: string | null;
};

type DeliveredOrder = {
  items: Array<{
    orderItemId: string;
    product: { title: string; sku: string };
    keys: DeliveredKey[];
  }>;
};

const paymentLabels: Record<string, string> = {
  CREATED: "بانتظار بدء الدفع",
  REQUIRES_ACTION: "بانتظار إتمام الدفع",
  SUCCEEDED: "تم الدفع",
  FAILED: "فشل الدفع",
  REFUNDED: "تم الاسترداد",
};

const orderLabels: Record<string, string> = {
  PENDING: "قيد المعالجة",
  PAID: "مدفوع",
  FULFILLING: "يجري التسليم",
  COMPLETED: "مكتمل",
  REFUNDED: "مسترد",
  CANCELLED: "ملغى",
  FAILED: "فشل",
};

export default function OrderHistory() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string>();
  const [delivered, setDelivered] = useState<Record<string, DeliveredOrder>>({});
  const [loadingKeys, setLoadingKeys] = useState<string>();

  useEffect(() => {
    fetch("/api/me/orders", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) throw new Error("UNAUTHORIZED");
        if (!response.ok) throw new Error("LOAD_FAILED");
        return response.json() as Promise<Order[]>;
      })
      .then(setOrders)
      .catch((reason: Error) => setError(reason.message));
  }, []);

  async function revealKeys(orderId: string) {
    setLoadingKeys(orderId);
    try {
      const response = await fetch(`/api/me/orders/${encodeURIComponent(orderId)}/keys`, { cache: "no-store" });
      if (!response.ok) throw new Error("KEYS_UNAVAILABLE");
      const data = await response.json() as DeliveredOrder;
      setDelivered((current) => ({ ...current, [orderId]: data }));
    } catch {
      setError("KEYS_UNAVAILABLE");
    } finally {
      setLoadingKeys(undefined);
    }
  }

  if (error === "UNAUTHORIZED") {
    return <div className="card"><h2>سجّل الدخول لمتابعة طلباتك</h2><p className="muted">تظهر هنا كل عمليات الدفع وحالة تسليم مفاتيح الألعاب.</p></div>;
  }

  if (error && error !== "KEYS_UNAVAILABLE") return <div className="card"><h2>تعذر تحميل الطلبات</h2><p className="muted">حاول تحديث الصفحة لاحقًا.</p></div>;
  if (orders === null) return <div className="card"><p className="muted">يجري تحميل طلباتك…</p></div>;
  if (!orders.length) return <div className="card"><h2>لا توجد طلبات بعد</h2><p className="muted">بعد إتمام أول عملية شراء، ستظهر حالتها هنا.</p></div>;

  return (
    <div className="grid">
      {orders.map((order) => {
        const deliveredOrder = delivered[order.id];
        return (
          <article className="card" key={order.id}>
            <div className="product-meta">
              <span className="pill">{orderLabels[order.status] || order.status}</span>
              <span className="pill">{paymentLabels[order.paymentStatus] || order.paymentStatus}</span>
            </div>
            <h2>طلب #{order.id.slice(-8)}</h2>
            <ul className="muted">
              {order.items.map((item) => <li key={item.id}>{item.product.title} × {item.quantity}</li>)}
            </ul>
            <p><strong>{(order.totalCents / 100).toFixed(2)} {order.currency}</strong></p>
            <p className="muted">{new Date(order.createdAt).toLocaleString("ar")}</p>

            {order.status === "COMPLETED" && !deliveredOrder && (
              <div>
                <button className="btn" type="button" onClick={() => revealKeys(order.id)} disabled={loadingKeys === order.id}>
                  {loadingKeys === order.id ? "يجري كشف المفتاح…" : "عرض مفاتيح اللعبة"}
                </button>
                {error === "KEYS_UNAVAILABLE" && <p className="muted" role="status">تعذر عرض المفاتيح حاليًا. تواصل مع الدعم إذا استمرت المشكلة.</p>}
              </div>
            )}

            {deliveredOrder && deliveredOrder.items.map((item) => (
              <section className="card" key={item.orderItemId}>
                <h3>{item.product.title}</h3>
                {item.keys.map((key) => <code key={key.id}>{key.code}</code>)}
              </section>
            ))}

            {order.paymentStatus === "SUCCEEDED" && order.status !== "COMPLETED" && (
              <p className="muted">تم تأكيد الدفع؛ يجري تجهيز التسليم الآمن.</p>
            )}
          </article>
        );
      })}
    </div>
  );
}
