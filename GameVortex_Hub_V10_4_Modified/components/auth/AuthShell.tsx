"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "../../app/auth/auth.module.css";

const FEATURES = [
  {
    title: "تجربة ألعاب استثنائية",
    subtitle: "على جميع المنصات",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2 15 8l6 1-4.5 4.4L17.5 20 12 17l-5.5 3 1-6.6L3 9l6-1z" />
      </svg>
    ),
  },
  {
    title: "أمان وحماية متقدمة",
    subtitle: "لبياناتك وحسابك",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2 4 5v6c0 5 3.4 9 8 11 4.6-2 8-6 8-11V5z" />
      </svg>
    ),
  },
  {
    title: "دعم فني 24/24",
    subtitle: "دائمًا بجانبك",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 2 4 14h6l-1 8 9-12h-6z" />
      </svg>
    ),
  },
  {
    title: "مكافآت وعروض حصرية",
    subtitle: "لأعضاء المجتمع",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 3h12l4 6-10 12L2 9z" />
      </svg>
    ),
  },
  {
    title: "مكتبة ضخمة من الألعاب",
    subtitle: "بجميع الأنواع",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3a9 9 0 0 0 0 18 9 9 0 0 0 0-18z" />
      </svg>
    ),
  },
];

function GoldLanguageSwitcher() {
  const [language, setLanguage] = useState<"ar" | "en">("ar");

  useEffect(() => {
    const saved = (localStorage.getItem("selectedLanguage") as "ar" | "en" | null) || "ar";
    setLanguage(saved);
  }, []);

  function apply(next: "ar" | "en") {
    setLanguage(next);
    document.documentElement.lang = next;
    document.documentElement.dir = next === "ar" ? "rtl" : "ltr";
    localStorage.setItem("selectedLanguage", next);
    window.dispatchEvent(new Event("gv-language-change"));
  }

  return (
    <div className={styles.langSwitch} aria-label="Language">
      <button type="button" onClick={() => apply("ar")} aria-pressed={language === "ar"}>العربية</button>
      <button type="button" onClick={() => apply("en")} aria-pressed={language === "en"}>English</button>
    </div>
  );
}

function LampIllustration() {
  return (
    <svg className={styles.lamp} width="150" height="220" viewBox="0 0 150 220" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <ellipse cx="75" cy="70" rx="70" ry="55" fill="url(#lampGlow)" />
      <path d="M40 40a35 22 0 0 1 70 0v6H40z" fill="#2a2013" stroke="#5c4321" strokeWidth="2" />
      <rect x="72" y="46" width="6" height="34" fill="#3a2c17" />
      <circle cx="75" cy="86" r="6" fill="#c98f2a" />
      <path d="M60 82h30l6 10H54z" fill="#1c1608" stroke="#5c4321" strokeWidth="2" />
      <rect x="70" y="92" width="10" height="70" fill="#241c0f" />
      <ellipse cx="75" cy="168" rx="34" ry="10" fill="#1c1608" stroke="#5c4321" strokeWidth="2" />
      <circle cx="75" cy="120" r="3" fill="#c98f2a" />
      <path d="M75 96v46" stroke="#c98f2a" strokeWidth="1.5" />
      <defs>
        <radialGradient id="lampGlow" cx="0.5" cy="0.35" r="0.65">
          <stop offset="0%" stopColor="#ffd98a" stopOpacity="0.9" />
          <stop offset="45%" stopColor="#ffb44a" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#ffb44a" stopOpacity="0" />
        </radialGradient>
      </defs>
    </svg>
  );
}

export default function AuthShell({
  heading,
  subtitle,
  children,
}: {
  heading: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}>
          <svg className={styles.brandMark} width="34" height="34" viewBox="0 0 40 40" fill="none">
            <path d="M20 3 36 30H4z" stroke="#ffc65c" strokeWidth="2.5" fill="none" />
            <path d="M20 13 28 27H12z" stroke="#ffc65c" strokeWidth="2" fill="none" />
          </svg>
          <span className={styles.brandText}>
            <strong>GAME<span>VORTEX</span></strong>
            <small>HUB</small>
          </span>
        </Link>
        <GoldLanguageSwitcher />
      </header>

      <div className={styles.body}>
        <div className={styles.side}>
          <LampIllustration />
          <div className={styles.features}>
            {FEATURES.map((f) => (
              <div className={styles.featureItem} key={f.title}>
                <span className={styles.featureIcon}>{f.icon}</span>
                <span className={styles.featureText}>
                  <strong>{f.title}</strong>
                  <span>{f.subtitle}</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.cardWrap}>
          <div className={styles.heading}>
            <h1>{heading}</h1>
            <p>{subtitle}</p>
          </div>
          {children}
        </div>
      </div>

      <footer className={styles.footer}>
        <div className={styles.brand} style={{ justifyContent: "center" }}>
          <svg width="26" height="26" viewBox="0 0 40 40" fill="none">
            <path d="M20 3 36 30H4z" stroke="#ffc65c" strokeWidth="2.5" fill="none" />
          </svg>
          <strong>GAMEVORTEX HUB</strong>
        </div>
        <span>بوابتك الموحدة لجميع منصات الألعاب</span>
      </footer>
    </main>
  );
}
