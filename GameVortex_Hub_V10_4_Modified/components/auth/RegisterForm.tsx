"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

export default function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [referralCode, setReferralCode] = useState(searchParams.get("ref") || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, username, password, referralCode: referralCode || undefined }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const messages: Record<string, string> = {
          ACCOUNT_ALREADY_EXISTS: "البريد الإلكتروني أو اسم المستخدم مستخدم بالفعل.",
          INVALID_INPUT: "تحقق من البيانات: اسم المستخدم 3-32 حرفًا (أحرف/أرقام/_) وكلمة مرور 10 أحرف على الأقل.",
          RATE_LIMITED: "محاولات كثيرة. حاول بعد قليل.",
          CSRF_ORIGIN_REJECTED: "طلب مرفوض. أعد تحميل الصفحة وحاول مجددًا.",
        };
        setError(messages[data.error] || "تعذّر إنشاء الحساب. حاول مجددًا.");
        return;
      }
      router.push("/profile/gamer");
      router.refresh();
    } catch {
      setError("تعذر الاتصال بالخادم. تحقق من اتصالك وحاول مجددًا.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card auth-form" onSubmit={onSubmit}>
      <label htmlFor="username">اسم المستخدم</label>
      <input id="username" className="input" required minLength={3} maxLength={32} pattern="[A-Za-z0-9_]+" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
      <label htmlFor="email">البريد الإلكتروني</label>
      <input id="email" className="input" type="email" required maxLength={320} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      <label htmlFor="password">كلمة المرور</label>
      <input id="password" className="input" type="password" required minLength={10} maxLength={200} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
      <label htmlFor="referralCode">رمز إحالة (اختياري)</label>
      <input id="referralCode" className="input" maxLength={40} value={referralCode} onChange={(e) => setReferralCode(e.target.value)} placeholder="مثال: MARWAN-A1B2C" />
      {error && <p className="muted" role="alert">{error}</p>}
      <button className="btn" type="submit" disabled={busy}>{busy ? "جارٍ الإنشاء…" : "إنشاء حساب"}</button>
      <p className="muted">لديك حساب بالفعل؟ <Link href="/auth/login">سجّل الدخول</Link></p>
    </form>
  );
}
