import Link from "next/link";
import styles from "../../app/home.module.css";

const PLATFORMS = [
  {
    name: "PC",
    query: "PC",
    icon: (
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="2" y="4" width="20" height="13" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </svg>
    ),
  },
  {
    name: "PlayStation",
    query: "PlayStation",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
        <path d="M8.98 1.5v18.16l3.15 1.02V4.9c0-.71.31-1.19.82-1.02.66.19.79.85.79 1.56v6.86c1.98.97 3.54.09 3.54-2.4 0-2.56-.9-3.7-3.5-4.63A38.6 38.6 0 0 0 8.98 1.5z" />
      </svg>
    ),
  },
  {
    name: "Xbox",
    query: "Xbox",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <circle cx="12" cy="12" r="9.5" />
        <path d="M6 6c2 2.5 3.6 4.4 6 4.4S16 8.5 18 6M6 18c2-2.5 3.6-4.4 6-4.4S16 15.5 18 18" />
      </svg>
    ),
  },
  {
    name: "Nintendo Switch",
    query: "Nintendo Switch",
    icon: (
      <svg width="22" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="2" y="2" width="8" height="20" rx="3" />
        <rect x="14" y="2" width="8" height="20" rx="3" />
        <circle cx="6" cy="7" r="1.4" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    name: "Android",
    query: "Android",
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
        <path d="M6 9v7a1 1 0 0 0 1 1h1v3a1.5 1.5 0 0 0 3 0v-3h2v3a1.5 1.5 0 0 0 3 0v-3h1a1 1 0 0 0 1-1V9zM17 3.4l1.3-1.7-.8-.6-1.4 1.9a7 7 0 0 0-8.2 0L6.5 1.1l-.8.6L7 3.4A6.6 6.6 0 0 0 4.2 8h15.6A6.6 6.6 0 0 0 17 3.4zM9 6.4a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8zm6 0a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8z" />
      </svg>
    ),
  },
  {
    name: "iOS",
    query: "iOS",
    icon: (
      <svg width="22" height="24" viewBox="0 0 24 24" fill="currentColor">
        <path d="M16.4 1c.1 1-.3 2-.9 2.8-.7.8-1.7 1.4-2.7 1.3-.1-1 .4-2 1-2.7.7-.8 1.9-1.4 2.6-1.4zm3.9 16.5c-.5 1.2-.8 1.7-1.4 2.8-.9 1.5-2.2 3.3-3.7 3.3-1.4 0-1.7-.9-3.5-.9-1.8 0-2.2.9-3.6.9-1.5 0-2.7-1.7-3.6-3.1C2.7 17.7 2 13.8 3.6 11.1c.8-1.3 2.2-2.2 3.7-2.2 1.4 0 2.3.9 3.5.9 1.1 0 1.8-.9 3.5-.9 1.2 0 2.5.7 3.4 1.8-3 1.6-2.5 5.9.6 6.8z" />
      </svg>
    ),
  },
  {
    name: "المزيد",
    query: "",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    ),
  },
];

export default function PlatformRow() {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="6" width="20" height="12" rx="3" />
            <path d="M7 10v4M5 12h4M15.5 11.5h.01M18 13.5h.01" />
          </svg>
          تصفح حسب المنصة
        </h2>
      </div>
      <div className={styles.hscroll}>
        {PLATFORMS.map((p) => (
          <Link key={p.name} href={p.query ? `/games?platform=${encodeURIComponent(p.query)}` : "/games"} className={styles.platformTile}>
            <span className={styles.platformIcon}>{p.icon}</span>
            <span>{p.name}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
