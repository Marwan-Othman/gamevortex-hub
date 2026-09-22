import Link from "next/link";
import styles from "../../app/home.module.css";

export default function VipBanner() {
  return (
    <section className={styles.vip} aria-label="GameVortex VIP">
      <div className={styles.vipOrb} aria-hidden="true" />

      <div className={styles.vipText}>
        <span className={styles.vipBadge}>
          <span>✦</span>
          GAMEVORTEX VIP
        </span>

        <h2>ارتقِ بتجربتك إلى مستوى آخر</h2>

        <p>
          مزايا حصرية وتجربة أكثر تميزًا داخل عالم GameVortex Hub.
        </p>
      </div>

      <Link href="/vip" className={styles.vipBtn}>
        اكتشف VIP

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
