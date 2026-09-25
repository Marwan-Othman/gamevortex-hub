"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import styles from "../../app/auth/auth.module.css";
import { AuthTextField, AuthPasswordField } from "./AuthFields";
import SocialLoginRow from "./SocialLoginRow";

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
    <div className={styles.cardWrap}>
      <form className={styles.card} onSubmit={onSubmit}>
        <div className={styles.cardTab}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
            <path d="M10 17l5-5-5-5M15 12H3" />
          </svg>
          تسجيل الدخول
        </div>

        <AuthTextField id="email" icon="mail" type="email" placeholder="البريد الإلكتروني" required maxLength={320} value={email} onChange={setEmail} autoComplete="email" />
        <AuthPasswordField id="password" placeholder="كلمة المرور" required maxLength={200} value={password} onChange={setPassword} visible={showPassword} onToggleVisible={() => setShowPassword((v) => !v)} autoComplete="current-password" />

        {error && <p className={styles.errorText} role="alert">{error}</p>}

        <button className={styles.submitBtn} type="submit" disabled={busy}>
          {busy ? "جارٍ الدخول…" : "تسجيل الدخول"}
          {!busy && (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
              <path d="M10 17l5-5-5-5M15 12H3" />
            </svg>
          )}
        </button>

        <SocialLoginRow />

        <p className={styles.switchLink}>ليس لديك حساب؟ <Link href="/auth/register">أنشئ حسابًا جديدًا</Link></p>
      </form>
    </div>
  );
}
