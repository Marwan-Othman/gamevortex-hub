"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import styles from "../../app/auth/auth.module.css";
import { AuthTextField, AuthPasswordField } from "./AuthFields";
import SocialLoginRow from "./SocialLoginRow";

export default function RegisterForm() {
  const router = useRouter();
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
      setError("كلمتا المرور غير متطابقتين.");
      return;
    }
    if (!acceptedTerms) {
      setError("يجب الموافقة على الشروط والأحكام وسياسة الخصوصية.");
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
    <div className={styles.cardWrap}>
      <form className={styles.card} onSubmit={onSubmit}>
        <div className={styles.cardTab}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="9" cy="8" r="3.5" />
            <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
            <path d="M18 8v5M15.5 10.5h5" />
          </svg>
          إنشاء حساب جديد
        </div>

        <AuthTextField id="username" icon="user" placeholder="اسم المستخدم" required minLength={3} maxLength={32} pattern="[A-Za-z0-9_]+" value={username} onChange={setUsername} autoComplete="username" />
        <AuthTextField id="email" icon="mail" type="email" placeholder="البريد الإلكتروني" required maxLength={320} value={email} onChange={setEmail} autoComplete="email" />
        <AuthPasswordField id="password" placeholder="كلمة المرور" required minLength={10} maxLength={200} value={password} onChange={setPassword} visible={showPassword} onToggleVisible={() => setShowPassword((v) => !v)} autoComplete="new-password" />
        <AuthPasswordField id="confirmPassword" placeholder="تأكيد كلمة المرور" required minLength={10} maxLength={200} value={confirmPassword} onChange={setConfirmPassword} visible={showConfirm} onToggleVisible={() => setShowConfirm((v) => !v)} autoComplete="new-password" />

        <div className={styles.field}>
          <label htmlFor="referralCode">رمز إحالة (اختياري)</label>
          <div className={styles.inputRow}>
            <input id="referralCode" placeholder="رمز إحالة (اختياري)" maxLength={40} value={referralCode} onChange={(e) => setReferralCode(e.target.value)} style={{ padding: "13px 14px" }} />
          </div>
        </div>

        <label className={styles.checkboxRow}>
          <input type="checkbox" checked={acceptedTerms} onChange={(e) => setAcceptedTerms(e.target.checked)} />
          أوافق على <Link href="/legal/terms">الشروط والأحكام</Link> و<Link href="/legal/privacy">سياسة الخصوصية</Link>
        </label>

        {error && <p className={styles.errorText} role="alert">{error}</p>}

        <button className={styles.submitBtn} type="submit" disabled={busy}>
          {busy ? "جارٍ الإنشاء…" : "إنشاء حساب جديد"}
          {!busy && (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <circle cx="9" cy="8" r="3.5" />
              <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
              <path d="M18 8v5M15.5 10.5h5" />
            </svg>
          )}
        </button>

        <SocialLoginRow />

        <p className={styles.switchLink}>لديك حساب بالفعل؟ <Link href="/auth/login">تسجيل الدخول</Link></p>
      </form>
    </div>
  );
}
