"use client";

import { useState } from "react";

type BuyNowButtonProps = {
  productId: string;
  productTitle: string;
  priceCents: number;
};

type ApiError = { error?: string };

function idempotencyKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

export default function BuyNowButton({ productId, productTitle, priceCents }: BuyNowButtonProps) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  async function buyFromWallet() {
    setBusy(true);
    setMessage(undefined);

    try {
      const walletResponse = await fetch("/api/wallet/transactions", { cache: "no-store" });
      const walletData = await walletResponse.json() as {
        wallet?: { balance?: string | number };
        error?: string;
      };

      if (!walletResponse.ok || walletData.wallet?.balance === undefined) {
        setMessage("تعذر التحقق من رصيد المحفظة.");
        return;
      }

      const balance = Number(walletData.wallet.balance);
      const price = priceCents / 100;

      if (!Number.isFinite(balance) || balance < price) {
        setMessage(`رصيد المحفظة غير كافٍ. الرصيد الحالي: ${Number.isFinite(balance) ? balance.toFixed(2) : "0.00"} USD.`);
        return;
      }

      const orderResponse = await fetch("/api/me/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: [{ productId, quantity: 1 }],
          idempotencyKey: idempotencyKey(),
        }),
      });
      const orderData = await orderResponse.json() as { id?: string; paymentStatus?: string } & ApiError;

      if (!orderResponse.ok || !orderData.id) {
        setMessage(orderData.error === "UNAUTHORIZED" ? "سجّل الدخول أولًا لإتمام الشراء." : "تعذر إنشاء الطلب.");
        return;
      }

      const paymentResponse = await fetch(`/api/me/orders/${encodeURIComponent(orderData.id)}/wallet-checkout`, {
        method: "POST",
      });
      const paymentData = await paymentResponse.json() as {
        balance?: string;
        error?: string;
      };

      if (!paymentResponse.ok) {
        if (paymentData.error === "INSUFFICIENT_WALLET_BALANCE") {
          setMessage("لم يعد رصيد المحفظة كافيًا لإتمام العملية.");
        } else if (paymentData.error === "OUT_OF_STOCK" || paymentData.error === "DIGITAL_KEY_ALREADY_CLAIMED") {
          setMessage("المنتج لم يعد متاحًا بالكمية المطلوبة.");
        } else {
          setMessage("تعذر إتمام الدفع من المحفظة. لم يتم الخصم إذا فشلت العملية.");
        }
        return;
      }

      setMessage("تم الشراء من المحفظة وتسليم المنتج بنجاح.");
      window.location.assign("/orders");
    } catch {
      setMessage("تعذر الاتصال بالخادم. تحقق من اتصالك ثم حاول مجددًا.");
    } finally {
      setBusy(false);
    }
  }

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
      const orderData = await orderResponse.json() as { id?: string; paymentStatus?: string } & ApiError;

      if (!orderResponse.ok || !orderData.id) {
        setMessage(orderData.error === "UNAUTHORIZED" ? "سجّل الدخول أولًا لإتمام الشراء." : "تعذر إنشاء الطلب. حدّث الصفحة وحاول مجددًا.");
        return;
      }

      if (orderData.paymentStatus === "NOT_REQUIRED" || priceCents === 0) {
        setMessage("تم تسليم المنتج المجاني وإضافة نقاطه إلى حسابك.");
        window.location.assign("/orders");
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
        {busy ? "يجري تجهيز الطلب…" : priceCents === 0 ? "استلام مجانًا" : "شراء الآن"}
      </button>
      {priceCents > 0 && (
        <button className="btn" type="button" onClick={buyFromWallet} disabled={busy} aria-label={`الدفع من المحفظة مقابل ${productTitle}`}>
          {busy ? "جاري الدفع…" : "الدفع من المحفظة"}
        </button>
      )}
      {message && <p className="muted" role="status" aria-live="polite">{message}</p>}
    </div>
  );
}
