"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import styles from "../../app/home.module.css";

const SLIDES = [
  {
    title: "عالم الألعاب في مكان واحد",
    subtitle: "اكتشف آلاف الألعاب والتطبيقات لجميع المنصات بجودة عالية وسرعة تحميل فائقة",
    href: "/games",
    cta: "استكشف الآن",
    bg: "radial-gradient(circle at 75% 30%, rgba(167,139,250,0.55), transparent 55%), linear-gradient(135deg,#1a1030,#0c0a1e)",
  },
  {
    title: "بطاقات VIP حصرية",
    subtitle: "مزايا استثنائية وتجربة لعب استثنائية لأعضاء GameVortex Hub",
    href: "/rewards",
    cta: "احصل على بطاقتك",
    bg: "radial-gradient(circle at 75% 30%, rgba(255,198,92,0.4), transparent 55%), linear-gradient(135deg,#241a3d,#120c24)",
  },
  {
    title: "أحدث إصدارات 2026",
    subtitle: "تابع أحدث الألعاب المضافة أولًا بأول من جميع المنصات",
    href: "/games?sort=newest",
    cta: "شاهد الجديد",
    bg: "radial-gradient(circle at 75% 30%, rgba(56,189,248,0.4), transparent 55%), linear-gradient(135deg,#0c1f30,#0a0a1e)",
  },
];

export default function HeroCarousel() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setIndex((i) => (i + 1) % SLIDES.length);
    }, 6000);
    return () => window.clearInterval(timer);
  }, []);

  const slide = SLIDES[index];
  const go = (delta: number) => setIndex((i) => (i + delta + SLIDES.length) % SLIDES.length);

  return (
    <div className={styles.hero}>
      <div className={styles.heroSlide} style={{ "--slide-bg": slide.bg } as React.CSSProperties}>
        <div className={styles.heroContent}>
          <h1>{slide.title}</h1>
          <p>{slide.subtitle}</p>
          <Link href={slide.href} className={styles.heroCta}>
            {slide.cta}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </Link>
        </div>
      </div>

      <button type="button" className={`${styles.heroArrow} ${styles.prev}`} onClick={() => go(-1)} aria-label="السابق">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M15 18l-6-6 6-6" /></svg>
      </button>
      <button type="button" className={`${styles.heroArrow} ${styles.next}`} onClick={() => go(1)} aria-label="التالي">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M9 18l6-6-6-6" /></svg>
      </button>

      <div className={styles.heroDots}>
        {SLIDES.map((s, i) => (
          <button key={s.title} type="button" aria-current={i === index} aria-label={`الشريحة ${i + 1}`} onClick={() => setIndex(i)} />
        ))}
      </div>
    </div>
  );
}
