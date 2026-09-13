import LoginForm from "@/components/auth/LoginForm";
import AuthShell from "@/components/auth/AuthShell";

export const metadata = {
  title: "تسجيل الدخول | GameVortex Hub",
  description: "سجّل الدخول إلى حسابك في GameVortex.",
};

export default function LoginPage() {
  return (
    <AuthShell heading="مرحباً بعودتك!" subtitle="سجل دخولك للاستمتاع بتجربة الألعاب الأكثر تميزًا">
      <LoginForm />
    </AuthShell>
  );
}
