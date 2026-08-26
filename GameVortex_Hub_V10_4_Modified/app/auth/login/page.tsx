import LoginForm from "@/components/auth/LoginForm";

export const metadata = {
  title: "تسجيل الدخول | GameVortex Hub",
  description: "سجّل الدخول إلى حسابك في GameVortex.",
};

export default function LoginPage() {
  return (
    <main className="wrap auth-wrap">
      <section className="hero">
        <div className="eyebrow">GAMEVORTEX ACCOUNT</div>
        <h1>تسجيل الدخول</h1>
        <p className="muted">أدخل بياناتك للوصول إلى مكتبتك، نقاطك، وسحوباتك.</p>
      </section>
      <LoginForm />
    </main>
  );
}
