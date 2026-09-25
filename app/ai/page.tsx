import styles from "./ai.module.css";
import AIChat from "./AIChat";
import Link from "next/link";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "GameVortex AI",
  description: "GameVortex AI - المساعد الذكي الرسمي داخل GameVortex Hub.",
};

export default function AIPage() {
  return (
    <main className={styles.page} dir="rtl">
      <section className={styles.hero}>
        <div className={styles.heroGlowOne} />
        <div className={styles.heroGlowTwo} />
        <div className={styles.heroContent}>
          <span className={styles.heroBadge}>GAMEVORTEX AI</span>
          <h1 className={styles.heroTitle}>
            ذكاء اصطناعي مصمم <span>لعالم الألعاب</span>
          </h1>
          <p className={styles.heroText}>
            اسأل عن الألعاب، اكتشف اقتراحات جديدة، وقارن بين الألعاب والمنصة من
            داخل GameVortex.
          </p>
          <div className={styles.heroActions}>
            <a href="#ai-chat" className={styles.primaryButton}>✦ ابدأ المحادثة</a>
            <Link href="/vip" className={styles.secondaryButton}>♛ اكتشف GameVortex VIP</Link>
          </div>
        </div>
        <div className={styles.aiOrb} aria-hidden="true">
          <div className={styles.orbRingOuter} />
          <div className={styles.orbRingMiddle} />
          <div className={styles.orbCore}>AI</div>
        </div>
      </section>

      <section className={styles.toolsSection}>
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.sectionKicker}>AI TOOLS</span>
            <h2>أدواتك الذكية <span>في مكان واحد</span></h2>
          </div>
          <p>واجهة AI الجديدة مرتبطة بأنظمة GameVortex الحالية بدون استبدال المستخدمين أو قاعدة البيانات أو VIP أو الدفع.</p>
        </div>
        <div className={styles.toolsGrid}>
          <article className={styles.toolCard}><div className={styles.toolIcon}>✦</div><div className={styles.toolContent}><span className={styles.toolLabel}>CHAT</span><h3>AI Chat</h3><p>محادثة ذكية مخصصة للألعاب والمنصة مع وصول آمن إلى بيانات GameVortex.</p></div></article>
          <article className={styles.toolCard}><div className={styles.toolIcon}>◈</div><div className={styles.toolContent}><span className={styles.toolLabel}>IMAGE</span><h3>AI Images</h3><p>قسم الصور يبقى ضمن بنية GameVortex AI ويستخدم رصيد الصور الخاص بالمستخدم.</p></div></article>
          <article className={styles.toolCard}><div className={styles.toolIcon}>▶</div><div className={styles.toolContent}><span className={styles.toolLabel}>VIDEO</span><h3>AI Video</h3><p>قسم الفيديو يبقى مرتبطًا برصيد الفيديو وخدمات المزود الموجودة في المشروع.</p></div></article>
        </div>
      </section>

      <section id="ai-chat" className={styles.chatSection}>
        <div className={styles.chatHeading}>
          <div><span className={styles.sectionKicker}>GAMEVORTEX AI</span><h2>تحدث مع <span>مساعدك الذكي</span></h2></div>
          <div className={styles.statusBadge}><span /> AI READY</div>
        </div>
        <div className={styles.chatWrapper}><AIChat /></div>
      </section>

      <section className={styles.featuresSection}>
        <div className={styles.featureCard}><div className={styles.featureIcon}>🎮</div><div><h3>مخصص للألعاب</h3><p>يفهم بيانات GameVortex الحقيقية بدل اختراع كتالوج وهمي.</p></div></div>
        <div className={styles.featureCard}><div className={styles.featureIcon}>⚡</div><div><h3>تجربة سريعة</h3><p>واجهة المحادثة الجديدة خفيفة ومباشرة وتعمل من داخل المنصة.</p></div></div>
        <div className={styles.featureCard}><div className={styles.featureIcon}>🔐</div><div><h3>حماية المفاتيح</h3><p>مفاتيح مزودي الذكاء الاصطناعي تبقى على الخادم ولا تصل إلى المتصفح.</p></div></div>
      </section>

      <section className={styles.vipBanner}>
        <div className={styles.vipBannerGlow} />
        <div className={styles.vipCrown}>♛</div>
        <div className={styles.vipContent}><span>GAMEVORTEX VIP</span><h2>احصل على رصيد AI أكبر<br />ومزايا حصرية</h2><p>باقات VIP تمنحك حدود استخدام أعلى داخل GameVortex Hub.</p></div>
        <Link href="/vip" className={styles.vipButton}>مشاهدة الباقات <span>←</span></Link>
      </section>
    </main>
  );
}
