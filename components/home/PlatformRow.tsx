"use client";

import Link from "next/link";
import { useLocale } from "@/components/ui/useLocale";
import styles from "../../app/home.module.css";

const PLATFORMS = [
  { name: "الألعاب", en: "Games", href: "/games", icon: <span>◈</span> },
  { name: "المتجر", en: "Store", href: "/marketplace", icon: <span>◇</span> },
  { name: "المكتبة", en: "Library", href: "/library", icon: <span>▣</span> },
  { name: "VIP", en: "VIP", href: "/vip", icon: <span>✦</span> },
  { name: "الذكاء", en: "AI", href: "/ai", icon: <span>✧</span> },
  { name: "المكافآت", en: "Rewards", href: "/rewards", icon: <span>★</span> },
];

export default function PlatformRow() {
  const english = useLocale() === "en";
  return (
    <section className={styles.section} aria-labelledby="platform-title">
      <div className={styles.sectionHead}>
        <h2 id="platform-title">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <rect x="2" y="6" width="20" height="12" rx="3" />
            <path d="M7 10v4M5 12h4M15.5 11.5h.01M18 13.5h.01" />
          </svg>
          {english ? "Quick access" : "الوصول السريع"}
        </h2>
      </div>

      <div className={styles.hscroll}>
        {PLATFORMS.map((platform) => (
          <Link key={platform.name} href={platform.href} className={styles.platformTile}>
            <span className={styles.platformIcon}>{platform.icon}</span>
            <span>{english ? platform.en : platform.name}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
