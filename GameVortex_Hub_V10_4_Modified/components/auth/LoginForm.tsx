"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const messages: Record<string, string> = {
          INVALID_CREDENTIALS: "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
          RATE_LIMITED: "محاولات كثيرة. حاول بعد قليل.",
          CSRF_ORIGIN_REJECTED: "طلب مرفوض. أعد تحميل الصفحة وحاول مجددًا.",
        };
        setError(messages[data.error] || "تعذّر تسجيل الدخول. حاول مجددًا.");
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
      <label htmlFor="email">البريد الإلكتروني</label>
      <input id="email" className="input" type="email" required maxLength={320} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      <label htmlFor="password">كلمة المرور</label>
      <input id="password" className="input" type="password" required maxLength={200} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
      {error && <p className="muted" role="alert">{error}</p>}
      <button className="btn" type="submit" disabled={busy}>{busy ? "جارٍ الدخول…" : "تسجيل الدخول"}</button>
      <p className="muted">ليس لديك حساب؟ <Link href="/auth/register">أنشئ حسابًا جديدًا</Link></p>
    </form>
  );
}
