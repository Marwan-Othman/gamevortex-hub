import { Suspense } from "react";
import RegisterForm from "@/components/auth/RegisterForm";

export const metadata = {
  title: "إنشاء حساب | GameVortex Hub",
  description: "أنشئ حسابك في GameVortex وابدأ باللعب والمشاركة في المكافآت والسحوبات.",
};

export default function RegisterPage() {
  return (
    <main className="wrap auth-wrap">
      <section className="hero">
        <div className="eyebrow">GAMEVORTEX ACCOUNT</div>
        <h1>إنشاء حساب جديد</h1>
        <p className="muted">انضم إلى GameVortex لبناء مكتبتك، كسب XP والنقاط، ودخول السحوبات.</p>
      </section>
      <Suspense fallback={<div className="card">جارٍ التحميل…</div>}>
        <RegisterForm />
      </Suspense>
    </main>
  );
}
