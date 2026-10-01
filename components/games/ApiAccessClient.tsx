"use client";

import { useEffect, useState } from "react";

type ApiKey = {
  id: string;
  label: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  requiresPurchase: boolean;
};

type ApiKeyResponse = { data: { purchased: boolean; paymentStatus: string | null; keys: ApiKey[]; activeKeyLimit: number } };

export default function ApiAccessClient() {
  const [purchased, setPurchased] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState<string | null>(null);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [limit, setLimit] = useState(3);
  const [label, setLabel] = useState("");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await fetch("/api/me/api-keys", { cache: "no-store" });
    if (!response.ok) throw new Error("LOAD_FAILED");
    const result = await response.json() as ApiKeyResponse;
    setPurchased(result.data.purchased);
    setPaymentStatus(result.data.paymentStatus);
    setKeys(result.data.keys);
    setLimit(result.data.activeKeyLimit);
  }

  useEffect(() => { void load().catch(() => setError("تعذر تحميل حالة الوصول.")); }, []);
  useEffect(() => {
    if (paymentStatus !== "PENDING") return;
    const interval = window.setInterval(() => void load().catch(() => undefined), 5_000);
    return () => window.clearInterval(interval);
  }, [paymentStatus]);

  async function buyAccess() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/api-access/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "CHECKOUT_FAILED");
      if (result.data.checkoutUrl) {
        window.location.assign(result.data.checkoutUrl);
      } else {
        throw new Error("PAYMENT_PROVIDER_CHECKOUT_URL_MISSING");
      }
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "CHECKOUT_FAILED";
      setError(code === "PAYMENT_PROVIDER_NOT_CONFIGURED"
        ? "الدفع غير مهيأ حاليًا. حاول لاحقًا أو تواصل مع المالك."
        : "تعذر بدء الدفع. لم يتم منح الوصول أو إنشاء أي رصيد.");
    } finally {
      setBusy(false);
    }
  }

  async function createKey(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSecret("");
    try {
      const response = await fetch("/api/me/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "CREATE_FAILED");
      setSecret(result.data.key);
      setLabel("");
      await load();
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "CREATE_FAILED";
      setError(code === "API_KEY_LIMIT_REACHED" ? `الحد الأقصى ${limit} مفاتيح نشطة.` : "تعذر إنشاء المفتاح.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setError("");
    try {
      const response = await fetch(`/api/me/api-keys/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("REVOKE_FAILED");
      await load();
    } catch {
      setError("تعذر إلغاء المفتاح.");
    }
  }

  const activeCount = keys.filter((key) => !key.revokedAt).length;

  return <main className="wrap" dir="rtl">
    <h1>واجهة GameVortex API</h1>
    <p>وصول خاص لبيانات الألعاب المنشورة. المفتاح لا يمنح صلاحيات كتابة أو إدارة.</p>
    {!purchased && <section aria-labelledby="api-price">
      <h2 id="api-price">وصول API · $10</h2>
      <p>يُفعّل الوصول بعد تأكيد مزوّد الدفع. لا ترسل المفتاح في المستودع أو المتصفح العام.</p>
      {paymentStatus === "PENDING" ? <p role="status">الدفع قيد التأكيد. لن يُمنح الوصول قبل تأكيد المزود.</p> : <button type="button" disabled={busy} onClick={() => void buyAccess()}>{busy ? "جارٍ الاتصال..." : "شراء الوصول"}</button>}
    </section>}
    {purchased && <section>
      <h2>مفاتيحك ({activeCount}/{limit})</h2>
      {activeCount < limit && <form onSubmit={(event) => void createKey(event)}>
        <label>اسم المفتاح <input required maxLength={80} value={label} onChange={(event) => setLabel(event.target.value)} /></label>
        <button type="submit" disabled={busy || !label.trim()}>{busy ? "جارٍ الإنشاء..." : "إنشاء مفتاح"}</button>
      </form>}
      {secret && <section role="status" aria-live="polite"><strong>انسخ المفتاح الآن؛ لن يظهر مجددًا.</strong><code dir="ltr" style={{ display: "block", overflowWrap: "anywhere" }}>{secret}</code><button type="button" onClick={() => void navigator.clipboard.writeText(secret)}>نسخ</button></section>}
      <ul>{keys.map((key) => <li key={key.id}>
        <code dir="ltr">{key.prefix}…</code> · {key.label} · {key.revokedAt ? "ملغى" : "نشط"}
        {key.lastUsedAt && ` · آخر استخدام ${new Date(key.lastUsedAt).toLocaleString()}`}
        {!key.revokedAt && <button type="button" onClick={() => void revoke(key.id)}>إلغاء</button>}
      </li>)}</ul>
      <h2>الاستخدام</h2>
      <pre dir="ltr"><code>{`curl "${typeof window === "undefined" ? "https://your-domain" : window.location.origin}/api/v1/games?limit=24" \\
  -H "Authorization: Bearer YOUR_API_KEY"`}</code></pre>
    </section>}
    {error && <p role="alert">{error}</p>}
  </main>;
}