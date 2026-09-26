"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import styles from "../../app/auth/auth.module.css";
import { AuthTextField, AuthPasswordField } from "./AuthFields";
import SocialLoginRow from "./SocialLoginRow";
import { useLocale } from "@/components/ui/useLocale";

export default function RegisterForm() {
  const router = useRouter();
  const english = useLocale() === "en";
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [referralCode, setReferralCode] = useState(searchParams.get("ref") || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);

    if (password !== confirmPassword) {
      setError(english ? "Passwords do not match." : "كلمتا المرور غير متطابقتين.");
      return;
    }
    if (!acceptedTerms) {
      setError(english ? "You must accept the Terms and Privacy Policy." : "يجب الموافقة على الشروط والأحكام وسياسة الخصوصية.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, username, password, referralCode: referralCode || undefined }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const messages: Record<string, string> = {
          ACCOUNT_ALREADY_EXISTS: english ? "That email or username is already in use." : "البريد الإلكتروني أو اسم المستخدم مستخدم بالفعل.",
          INVALID_INPUT: english ? "Check your details: username must be 3–32 letters, numbers or underscores; password at least 10 characters." : "تحقق من البيانات: اسم المستخدم 3-32 حرفًا (أحرف/أرقام/_) وكلمة مرور 10 أحرف على الأقل.",
          RATE_LIMITED: english ? "Too many attempts. Please try again shortly." : "محاولات كثيرة. حاول بعد قليل.",
          CSRF_ORIGIN_REJECTED: english ? "Request rejected. Reload and try again." : "طلب مرفوض. أعد تحميل الصفحة وحاول مجددًا.",
        };
        setError(messages[data.error] || (english ? "Could not create your account. Please try again." : "تعذّر إنشاء الحساب. حاول مجددًا."));
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
            <circle cx="9" cy="8" r="3.5" />
            <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
            <path d="M18 8v5M15.5 10.5h5" />
          </svg>
          {english ? "Create account" : "إنشاء حساب جديد"}
        </div>

        <AuthTextField id="username" icon="user" placeholder={english ? "Username" : "اسم المستخدم"} required minLength={3} maxLength={32} pattern="[A-Za-z0-9_]+" value={username} onChange={setUsername} autoComplete="username" />
        <AuthTextField id="email" icon="mail" type="email" placeholder={english ? "Email address" : "البريد الإلكتروني"} required maxLength={320} value={email} onChange={setEmail} autoComplete="email" />
        <AuthPasswordField id="password" placeholder={english ? "Password" : "كلمة المرور"} required minLength={10} maxLength={200} value={password} onChange={setPassword} visible={showPassword} onToggleVisible={() => setShowPassword((v) => !v)} autoComplete="new-password" />
        <AuthPasswordField id="confirmPassword" placeholder={english ? "Confirm password" : "تأكيد كلمة المرور"} required minLength={10} maxLength={200} value={confirmPassword} onChange={setConfirmPassword} visible={showConfirm} onToggleVisible={() => setShowConfirm((v) => !v)} autoComplete="new-password" />

        <div className={styles.field}>
          <label htmlFor="referralCode">{english ? "Referral code (optional)" : "رمز إحالة (اختياري)"}</label>
          <div className={styles.inputRow}>
            <input id="referralCode" placeholder={english ? "Referral code (optional)" : "رمز إحالة (اختياري)"} maxLength={40} value={referralCode} onChange={(e) => setReferralCode(e.target.value)} style={{ padding: "13px 14px" }} />
          </div>
        </div>

        <label className={styles.checkboxRow}>
          <input type="checkbox" checked={acceptedTerms} onChange={(e) => setAcceptedTerms(e.target.checked)} />
          {english ? "I accept the " : "أوافق على "}<Link href="/legal/terms">{english ? "Terms" : "الشروط والأحكام"}</Link>{english ? " and " : " و"}<Link href="/legal/privacy">{english ? "Privacy Policy" : "سياسة الخصوصية"}</Link>
        </label>

        {error && <p className={styles.errorText} role="alert">{error}</p>}

        <button className={styles.submitBtn} type="submit" disabled={busy}>
          {busy ? (english ? "Creating account…" : "جارٍ الإنشاء…") : (english ? "Create account" : "إنشاء حساب جديد")}
          {!busy && (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <circle cx="9" cy="8" r="3.5" />
              <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
              <path d="M18 8v5M15.5 10.5h5" />
            </svg>
          )}
        </button>

        <SocialLoginRow />

        <p className={styles.switchLink}>{english ? "Already have an account?" : "لديك حساب بالفعل؟"} <Link href="/auth/login">{english ? "Sign in" : "تسجيل الدخول"}</Link></p>
      </form>
    </div>
  );
}
