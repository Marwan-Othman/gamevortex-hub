import Link from "next/link";
import styles from "../../app/home.module.css";

const CATEGORIES = [
  {
    name: "أكشن",
    genre: "Action",
    color: "#ff4d6d",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M6 6l12 12M18 6 6 18" />
      </svg>
    ),
  },
  {
    name: "مغامرات",
    genre: "Adventure",
    color: "#4f8fff",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="9" />
        <path d="m14.5 9.5-2 5-5 2 2-5z" />
      </svg>
    ),
  },
  {
    name: "رياضة",
    genre: "Sports",
    color: "#3ddc84",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c2.5 2.5 2.5 15.5 0 18M12 3C9.5 5.5 9.5 18.5 12 21" />
      </svg>
    ),
  },
  {
    name: "سباق",
    genre: "Racing",
    color: "#ffc94a",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 22 14 2l2 4-6 12h6l-8 4" />
      </svg>
    ),
  },
  {
    name: "رعب",
    genre: "Horror",
    color: "#9a5cff",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2a8 8 0 0 0-8 8v6a2 2 0 0 0 2 2h1v-3l2 3h6l2-3v3h1a2 2 0 0 0 2-2v-6a8 8 0 0 0-8-8z" />
        <circle cx="9" cy="11" r="1" fill="currentColor" />
        <circle cx="15" cy="11" r="1" fill="currentColor" />
      </svg>
    ),
  },
  {
    name: "استراتيجية",
    genre: "Strategy",
    color: "#34d8ff",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M6 20h12M8 20V10l-1-3h10l-1 3v10M9 7V4h6v3" />
      </svg>
    ),
  },
  {
    name: "المزيد",
    genre: "",
    color: "#a3a8c2",
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

export default function CategoriesRow() {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="m12 2 2.5 6.5L21 9l-5 4 1.5 7-5.5-3.5L6.5 20 8 13 3 9l6.5-.5z" />
          </svg>
          التصنيفات الرئيسية
        </h2>
      </div>
      <div className={styles.hscroll}>
        {CATEGORIES.map((c) => (
          <Link
            key={c.name}
            href={c.genre ? `/games?genre=${encodeURIComponent(c.genre)}` : "/categories"}
            className={styles.categoryTile}
            style={{ "--cat-color": c.color } as React.CSSProperties}
          >
            <span className={styles.categoryIcon}>{c.icon}</span>
            <span>{c.name}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
