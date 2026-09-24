"use client";

import { useState } from "react";

type BuyNowButtonProps = {
  productId: string;
  productTitle: string;
};

type ApiError = { error?: string };

function idempotencyKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}-gamevortex-order`;
}

export default function BuyNowButton({ productId, productTitle }: BuyNowButtonProps) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  async function buyNow() {
    setBusy(true);
    setMessage(undefined);

    try {
      const orderResponse = await fetch("/api/me/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{ productId, quantity: 1 }],
          idempotencyKey: idempotencyKey(),
        }),
      });
      const orderData = await orderResponse.json() as { id?: string } & ApiError;

      if (!orderResponse.ok || !orderData.id) {
        setMessage(orderData.error === "UNAUTHORIZED" ? "سجّل الدخول أولًا لإتمام الشراء." : "تعذر إنشاء الطلب. حدّث الصفحة وحاول مجددًا.");
        return;
      }

      const checkoutResponse = await fetch(`/api/me/orders/${encodeURIComponent(orderData.id)}/checkout`, {
        method: "POST",
      });
      const checkoutData = await checkoutResponse.json() as { checkoutUrl?: string } & ApiError;

      if (!checkoutResponse.ok || !checkoutData.checkoutUrl) {
        if (checkoutData.error === "PAYMENT_PROVIDER_NOT_CONFIGURED") {
          setMessage("الدفع غير مهيأ بعد. لا يتم تحصيل أي مبلغ.");
        } else if (checkoutData.error === "UNAUTHORIZED") {
          setMessage("انتهت جلستك. سجّل الدخول ثم حاول مرة أخرى.");
        } else {
          setMessage("تعذر بدء الدفع. لم يتم تحصيل أي مبلغ.");
        }
        return;
      }

      window.location.assign(checkoutData.checkoutUrl);
    } catch {
      setMessage("تعذر الاتصال بالخادم. تحقق من اتصالك ثم حاول مجددًا.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button className="btn" type="button" onClick={buyNow} disabled={busy} aria-label={`شراء ${productTitle}`}>
        {busy ? "يجري تجهيز الدفع…" : "شراء الآن"}
      </button>
      {message && <p className="muted" role="status" aria-live="polite">{message}</p>}
    </div>
  );
}
