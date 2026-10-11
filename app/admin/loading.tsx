import styles from "./admin.module.css";

/**
 * Shown while any admin page is fetching its data. Because it lives in the
 * admin segment the sidebar/top bar stay on screen and only the content area
 * shows the skeleton.
 */
export default function AdminLoading() {
  return (
    <div dir="rtl" role="status" aria-live="polite" aria-busy="true">
      <span className="muted" style={{ display: "block", marginBottom: 12 }}>
        جارٍ التحميل...
      </span>

      <div className={styles.skeletonLine} style={{ height: 22, width: "40%" }} />

      <div className={styles.skeletonGrid}>
        <div className={styles.skeletonCard} />
        <div className={styles.skeletonCard} />
        <div className={styles.skeletonCard} />
        <div className={styles.skeletonCard} />
      </div>
    </div>
  );
}
