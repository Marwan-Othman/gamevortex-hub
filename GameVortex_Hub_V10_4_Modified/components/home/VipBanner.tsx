import Link from "next/link";
import styles from "../../app/home.module.css";

export default function VipBanner() {
  return (
    <section className={styles.vip}>
      <div className={styles.vipText}>
        <h2>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 3h12l4 6-10 12L2 9z" />
          </svg>
          بطاقات VIP
        </h2>
        <p>مزايا حصرية وتجربة لعب استثنائية</p>
        <Link href="/rewards" className={styles.vipBtn}>
          احصل على بطاقتك الآن
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </Link>
      </div>
      <span className={styles.vipBadge}>VIP</span>
    </section>
  );
}
