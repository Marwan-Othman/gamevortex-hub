import AIChat from "./AIChat";

export const dynamic =
  "force-dynamic";

export default function AIPage() {
  return (
    <main
      className="wrap"
      dir="rtl"
    >
      <section className="glass hero">
        <span className="badge">
          GAMEVORTEX AI
        </span>

        <h1>
          GameVortex AI
        </h1>

        <p>
          مساعدك الذكي داخل GameVortex Hub
          للألعاب والتطبيقات والمنصة.
        </p>
      </section>

      <AIChat />

      <section className="grid">
        <article className="glass card">
          <h2>
            🎮 الألعاب
          </h2>

          <p className="muted">
            ساعد نفسك في اكتشاف الألعاب
            وفهم الأنظمة والمنصات.
          </p>
        </article>

        <article className="glass card">
          <h2>
            🧠 مساعد ذكي
          </h2>

          <p className="muted">
            محادثة مباشرة من داخل
            GameVortex Hub.
          </p>
        </article>

        <article className="glass card">
          <h2>
            🔐 حماية
          </h2>

          <p className="muted">
            مفاتيح مزود الذكاء الاصطناعي
            تبقى على الخادم.
          </p>
        </article>
      </section>
    </main>
  );
}
