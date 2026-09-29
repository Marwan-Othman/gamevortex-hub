"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import styles from "../../app/auth/auth.module.css";
import { AuthTextField, AuthPasswordField } from "./AuthFields";
import SocialLoginRow from "./SocialLoginRow";
import { useLocale } from "@/components/ui/useLocale";

export default function LoginForm() {
  const router = useRouter();
  const english = useLocale() === "en";
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
          INVALID_CREDENTIALS: english ? "Email or password is incorrect." : "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
          RATE_LIMITED: english ? "Too many attempts. Please try again shortly." : "محاولات كثيرة. حاول بعد قليل.",
          CSRF_ORIGIN_REJECTED: english ? "Request rejected. Reload and try again." : "طلب مرفوض. أعد تحميل الصفحة وحاول مجددًا.",
        };
        setError(messages[data.error] || (english ? "Could not sign in. Please try again." : "تعذّر تسجيل الدخول. حاول مجددًا."));
        return;
      }
      router.push("/profile/gamer");
      router.refresh();
    } catch {
      setError(english ? "Could not reach the server. Check your connection and try again." : "تعذر الاتصال بالخادم. تحقق من اتصالك وحاول مجددًا.");
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
          {english ? "Sign in" : "تسجيل الدخول"}
        </div>

        <AuthTextField id="email" icon="mail" type="email" placeholder={english ? "Email address" : "البريد الإلكتروني"} required maxLength={320} value={email} onChange={setEmail} autoComplete="email" />
        <AuthPasswordField id="password" placeholder={english ? "Password" : "كلمة المرور"} required maxLength={200} value={password} onChange={setPassword} visible={showPassword} onToggleVisible={() => setShowPassword((v) => !v)} autoComplete="current-password" />

        {error && <p className={styles.errorText} role="alert">{error}</p>}

        <button className={styles.submitBtn} type="submit" disabled={busy}>
          {busy ? (english ? "Signing in…" : "جارٍ الدخول…") : (english ? "Sign in" : "تسجيل الدخول")}
          {!busy && (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
              <path d="M10 17l5-5-5-5M15 12H3" />
            </svg>
          )}
        </button>

        <SocialLoginRow />

        <p className={styles.switchLink}>{english ? "New to GameVortex?" : "ليس لديك حساب؟"} <Link href="/auth/register">{english ? "Create an account" : "أنشئ حسابًا جديدًا"}</Link></p>
      </form>
    </div>
  );
}
