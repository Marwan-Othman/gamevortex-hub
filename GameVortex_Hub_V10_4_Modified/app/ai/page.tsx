import Link from "next/link";
import AIChat from "./AIChat";
import styles from "./ai.module.css";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "GameVortex AI",
  description:
    "GameVortex AI - مساعدك الذكي للألعاب والتطبيقات ومنصة GameVortex Hub.",
};

export default function AIPage() {
  return (
    <main className={styles.page} dir="rtl">
      <section className={styles.hero}>
        <div className={styles.heroGlowOne} />
        <div className={styles.heroGlowTwo} />

        <div className={styles.heroContent}>
          <div className={styles.heroBadge}>
            <span className={styles.badgeDot} />
            GAMEVORTEX AI
          </div>

          <h1 className={styles.heroTitle}>
            ذكاء اصطناعي
            <span> مصمم لعالم الألعاب</span>
          </h1>

          <p className={styles.heroText}>
            مساعدك الذكي داخل GameVortex Hub. اسأل، اكتشف، حلل واستكشف
            عالم الألعاب والتطبيقات من مكان واحد.
          </p>

          <div className={styles.heroActions}>
            <a href="#ai-chat" className={styles.primaryButton}>
              <span className={styles.buttonIcon}>✦</span>
              ابدأ المحادثة
            </a>

            <Link href="/vip" className={styles.secondaryButton}>
              <span className={styles.buttonIcon}>♛</span>
              اكتشف GameVortex VIP
            </Link>
          </div>
        </div>

        <div className={styles.aiOrb}>
          <div className={styles.orbRingOuter} />
          <div className={styles.orbRingMiddle} />
          <div className={styles.orbCore}>
            <span>AI</span>
          </div>

          <div className={`${styles.orbParticle} ${styles.particleOne}`} />
          <div className={`${styles.orbParticle} ${styles.particleTwo}`} />
          <div className={`${styles.orbParticle} ${styles.particleThree}`} />
        </div>
      </section>

      <section className={styles.toolsSection}>
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.sectionKicker}>AI TOOLS</span>

            <h2>
              أدواتك الذكية
              <span> في مكان واحد</span>
            </h2>
          </div>

          <p>
            استخدم أدوات GameVortex AI للوصول إلى تجربة أكثر ذكاءً داخل
            المنصة.
          </p>
        </div>

        <div className={styles.toolsGrid}>
          <article className={styles.toolCard}>
            <div className={styles.toolIcon}>✦</div>

            <div className={styles.toolContent}>
              <span className={styles.toolLabel}>CHAT</span>

              <h3>AI Chat</h3>

              <p>
                تحدث مع مساعد GameVortex AI واحصل على المساعدة في الألعاب
                والتطبيقات والمنصة.
              </p>
            </div>
          </article>

          <article className={styles.toolCard}>
            <div className={styles.toolIcon}>◈</div>

            <div className={styles.toolContent}>
              <span className={styles.toolLabel}>IMAGE</span>

              <h3>AI Images</h3>

              <p>
                مساحة مخصصة لإنشاء الصور بالذكاء الاصطناعي عند توفر خدمة
                الصور ورصيدها.
              </p>
            </div>
          </article>

          <article className={styles.toolCard}>
            <div className={styles.toolIcon}>▶</div>

            <div className={styles.toolContent}>
              <span className={styles.toolLabel}>VIDEO</span>

              <h3>AI Video</h3>

              <p>
                واجهة جاهزة لخدمات الفيديو بالذكاء الاصطناعي مع احتساب
                الاستخدام من رصيد الفيديو.
              </p>
            </div>
          </article>
        </div>
      </section>

      <section id="ai-chat" className={styles.chatSection}>
        <div className={styles.chatHeading}>
          <div>
            <span className={styles.sectionKicker}>GAMEVORTEX AI</span>

            <h2>
              تحدث مع
              <span> مساعدك الذكي</span>
            </h2>
          </div>

          <div className={styles.statusBadge}>
            <span />
            AI READY
          </div>
        </div>

        <div className={styles.chatWrapper}>
          <AIChat />
        </div>
      </section>

      <section className={styles.featuresSection}>
        <div className={styles.featureCard}>
          <div className={styles.featureIcon}>🎮</div>

          <div>
            <h3>مخصص للألعاب</h3>

            <p>
              اسأل عن الألعاب والمنصات والأنظمة واحصل على مساعدة داخل
              GameVortex Hub.
            </p>
          </div>
        </div>

        <div className={styles.featureCard}>
          <div className={styles.featureIcon}>⚡</div>

          <div>
            <h3>تجربة سريعة</h3>

            <p>
              واجهة مصممة للوصول السريع إلى أدوات الذكاء الاصطناعي بدون
              مغادرة المنصة.
            </p>
          </div>
        </div>

        <div className={styles.featureCard}>
          <div className={styles.featureIcon}>🔐</div>

          <div>
            <h3>حماية المفاتيح</h3>

            <p>
              مفاتيح مزودي الذكاء الاصطناعي يجب أن تبقى على الخادم ولا يتم
              إرسالها إلى المتصفح.
            </p>
          </div>
        </div>
      </section>

      <section className={styles.vipBanner}>
        <div className={styles.vipBannerGlow} />

        <div className={styles.vipCrown}>♛</div>

        <div className={styles.vipContent}>
          <span>GAMEVORTEX VIP</span>

          <h2>
            احصل على رصيد AI أكبر
            <br />
            ومزايا حصرية
          </h2>

          <p>
            باقات VIP تمنحك حدود استخدام أعلى ومزايا إضافية داخل
            GameVortex Hub.
          </p>
        </div>

        <Link href="/vip" className={styles.vipButton}>
          مشاهدة الباقات
          <span>←</span>
        </Link>
      </section>
    </main>
  );
}
