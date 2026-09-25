import Link from "next/link";
import styles from "../../app/home.module.css";

const CATEGORIES = [
  {
    name: "أكشن",
    query: "Action",
    symbol: "⚔",
  },
  {
    name: "مغامرات",
    query: "Adventure",
    symbol: "✦",
  },
  {
    name: "رياضة",
    query: "Sports",
    symbol: "◉",
  },
  {
    name: "سباقات",
    query: "Racing",
    symbol: "ϟ",
  },
  {
    name: "رعب",
    query: "Horror",
    symbol: "☠",
  },
  {
    name: "استراتيجية",
    query: "Strategy",
    symbol: "♟",
  },
  {
    name: "ألعاب RPG",
    query: "RPG",
    symbol: "✧",
  },
  {
    name: "المزيد",
    query: "",
    symbol: "＋",
  },
];

export default function CategoriesRow() {
  return (
    <section className={styles.section} aria-labelledby="categories-title">
      <div className={styles.sectionHead}>
        <h2 id="categories-title">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <circle cx="7" cy="7" r="3" />
            <circle cx="17" cy="7" r="3" />
            <circle cx="7" cy="17" r="3" />
            <circle cx="17" cy="17" r="3" />
          </svg>
          استكشف التصنيفات
        </h2>

        <Link href="/games">عرض الكل ←</Link>
      </div>

      <div className={styles.hscroll}>
        {CATEGORIES.map((category) => (
          <Link
            key={category.name}
            href={
              category.query
                ? `/games?genre=${encodeURIComponent(category.query)}`
                : "/games"
            }
            className={styles.categoryTile}
          >
            <span className={styles.categoryIcon}>{category.symbol}</span>
            <span>{category.name}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
