"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Props = { productId: string; priceLabel: string; available: boolean };
const messages: Record<string, string> = {
  UNAUTHORIZED: "سجّل الدخول أولًا لإتمام الشراء.",
  PRODUCT_NOT_AVAILABLE: "هذه البطاقة لم تعد متاحة للبيع.",
  PRODUCT_NOT_AVAILABLE_FOR_SALE: "هذه البطاقة لم تعد متاحة للبيع.",
  ORDER_ITEM_NOT_AVAILABLE_FOR_SALE: "هذه البطاقة لم تعد متاحة للبيع.",
  ORDER_PRICE_CHANGED: "تغيّر السعر. حدّث الصفحة ثم حاول مجددًا.",
  INSUFFICIENT_WALLET_BALANCE: "رصيد المحفظة غير كافٍ.",
  PAYMENT_PROVIDER_NOT_CONFIGURED: "الدفع بالبطاقة غير مفعّل حاليًا.",
  DIGITAL_KEYS_OUT_OF_STOCK: "نفد المخزون من هذه الفئة.",
  OUT_OF_STOCK: "نفد المخزون من هذه الفئة.",
};
export default function GiftCardPurchase({ productId, priceLabel, available }: Props) {
  const [busy, setBusy] = useState<"wallet" | "card" | null>(null);
  const [error, setError] = useState("");
  const idempotencyKey = useRef<string | null>(null);
  const router = useRouter();

  async function purchase(method: "wallet" | "card") {
    if (busy || !available) return;
    setBusy(method); setError("");
    idempotencyKey.current ??= crypto.randomUUID();
    try {
      const orderResponse = await fetch("/api/me/orders", {
        method: "POST", headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ items: [{ productId, quantity: 1 }], idempotencyKey: idempotencyKey.current }),
      });
      const order = await orderResponse.json().catch(() => ({}));
      if (!orderResponse.ok || typeof order.id !== "string") {
        throw new Error(typeof order.error === "string" ? order.error : "ORDER_CREATE_FAILED");
      }
      if (order.status === "COMPLETED" || order.paymentStatus === "NOT_REQUIRED") {
        idempotencyKey.current = null;
        router.push(`/orders?purchase=${encodeURIComponent(order.id)}`); router.refresh(); return;
      }
      const endpoint = method === "wallet"
        ? `/api/me/orders/${encodeURIComponent(order.id)}/wallet-checkout`
        : `/api/me/orders/${encodeURIComponent(order.id)}/checkout`;
      const response = await fetch(endpoint, {
        method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: "{}",
      });
      const checkout = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof checkout.error === "string" ? checkout.error : "CHECKOUT_FAILED");
      if (method === "card") {
        if (typeof checkout.checkoutUrl !== "string") throw new Error("CHECKOUT_URL_MISSING");
        let url: URL;
        try { url = new URL(checkout.checkoutUrl); } catch { throw new Error("CHECKOUT_URL_MISSING"); }
        if (url.protocol !== "https:") throw new Error("CHECKOUT_URL_MISSING");
        window.location.assign(url.toString()); return;
      }
      idempotencyKey.current = null;
      router.push(`/orders?purchase=${encodeURIComponent(order.id)}`); router.refresh();
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "CHECKOUT_FAILED";
      setError(messages[code] ?? "تعذر إتمام الشراء. تحقق من الطلبات وحاول مرة أخرى.");
    } finally { setBusy(null); }
  }

  return <div className="gv-gift-purchase">
    <div className="gv-gift-purchase-price">{priceLabel}</div>
    <div className="gv-gift-purchase-actions">
      <button type="button" disabled={!available || busy !== null} onClick={() => void purchase("wallet")}>
        {busy === "wallet" ? "جارٍ الشراء…" : "شراء من المحفظة"}
      </button>
      <button type="button" className="secondary" disabled={!available || busy !== null} onClick={() => void purchase("card")}>
        {busy === "card" ? "جارٍ التحويل للدفع…" : "الدفع بالبطاقة"}
      </button>
    </div>
    {error ? <p className="gv-gift-purchase-error" role="alert">{error}</p> : null}
  </div>;
}
