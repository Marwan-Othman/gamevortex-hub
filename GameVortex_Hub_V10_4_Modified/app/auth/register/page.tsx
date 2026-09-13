import { Suspense } from "react";
import RegisterForm from "@/components/auth/RegisterForm";
import AuthShell from "@/components/auth/AuthShell";

export const metadata = {
  title: "إنشاء حساب | GameVortex Hub",
  description: "أنشئ حسابك في GameVortex وابدأ باللعب والمشاركة في المكافآت والسحوبات.",
};

export default function RegisterPage() {
  return (
    <AuthShell heading="مرحباً بعودتك!" subtitle="سجل دخولك أو أنشئ حساب جديد للاستمتاع بتجربة الألعاب الأكثر تميزًا">
      <Suspense fallback={<div className="card">جارٍ التحميل…</div>}>
        <RegisterForm />
      </Suspense>
    </AuthShell>
  );
}
