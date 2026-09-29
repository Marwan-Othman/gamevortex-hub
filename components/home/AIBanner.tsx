import Link from "next/link";
import styles from "../../app/home.module.css";

export default function AIBanner() {
  return (
    <section className={styles.aiBanner} aria-label="GameVortex AI">
      <div className={styles.aiImage}>
        <img
          src="/images/home/file_0000000093788243a14953a1be8bcb87.png"
          alt="GameVortex AI"
          loading="lazy"
        />
      </div>

      <div className={styles.aiText}>
        <span className={styles.aiBadge}>
          <span>✦</span>
          GAMEVORTEX AI
        </span>

        <h2>ذكاء اصطناعي لعالم الألعاب</h2>

        <p>
          Chat • Image • Video
          <br />
          Game Tools • AI Assistant
        </p>
      </div>

      <Link href="/ai" className={styles.aiBtn}>
        ابدأ مع AI

        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          aria-hidden="true"
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
      </Link>
    </section>
  );
}
