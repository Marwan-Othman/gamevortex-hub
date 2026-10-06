"use client";

import Link from "next/link";
import styles from "../../app/home.module.css";
import { useLocale } from "@/components/ui/useLocale";

type Props = {
  gamesCount?: number;
  appsCount?: number;
};

const Arrow = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    aria-hidden="true"
  >
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

function StatIcon({ children }: { children: React.ReactNode }) {
  return (
    <span className={styles.heroStatIcon} aria-hidden="true">
      {children}
    </span>
  );
}

export default function HeroCarousel({
  gamesCount = 0,
  appsCount = 0,
}: Props) {
  const locale = useLocale();
  const english = locale === "en";
  const t = (ar: string, en: string) => (english ? en : ar);

  const formatCount = (value: number) =>
    value >= 1000
      ? `${value.toLocaleString("en-US")}+`
      : String(value);

  const portals = [
    {
      href: "/games?platform=pc",
      kicker: "PC",
      titleAr: "ألعاب PC",
      titleEn: "PC Games",
      textAr: "عالم الحاسوب",
      textEn: "Desktop gaming",
      icon: "▣",
    },
    {
      href: "/games?platform=android",
      kicker: "MOBILE",
      titleAr: "ألعاب الموبايل",
      titleEn: "Mobile Games",
      textAr: "العب أينما كنت",
      textEn: "Play anywhere",
      icon: "▯",
    },
    {
      href: "/apps",
      kicker: "APPS",
      titleAr: "التطبيقات",
      titleEn: "Apps",
      textAr: "أدوات وتطبيقات رقمية",
      textEn: "Digital tools & apps",
      icon: "✦",
    },
    {
      href: "/gift-cards",
      kicker: "GIFTS",
      titleAr: "بطاقات الهدايا",
      titleEn: "Gift Cards",
      textAr: "رصيد ومنتجات رقمية",
      textEn: "Credits & digital goods",
      icon: "◇",
    },
  ];

  return (
    <div
      className={styles.heroGrid}
      dir={english ? "ltr" : "rtl"}
      lang={locale}
    >
      <section
        className={styles.hero}
        aria-label="GameVortex"
        style={
          {
            "--hero-desktop": "url('/images/home/hero-desktop.png')",
            "--hero-mobile": "url('/images/home/hero-mobile.png')",
          } as React.CSSProperties
        }
      >
        <div className={styles.heroArtwork} aria-hidden="true" />
        <div className={styles.heroOverlay} aria-hidden="true" />

        <div className={styles.heroContent}>
          <span className={styles.heroEyebrow}>
            {t("مرحبًا بك في GAMEVORTEX", "WELCOME TO GAMEVORTEX")}
          </span>

          <h1 className={styles.heroTitle}>GameVortex Hub</h1>

          <p className={styles.heroTag}>
            {t("عالم كامل من الألعاب بين يديك", "A whole gaming world in your hands")}
          </p>

          <p className={styles.heroLead}>
            {t(
              "اكتشف الألعاب، التطبيقات، بطاقات الهدايا، VIP وأدوات الذكاء الاصطناعي داخل تجربة واحدة مصممة حول اللاعب.",
              "Discover games, apps, gift cards, VIP and AI tools inside one player-first experience."
            )}
          </p>

          <div className={styles.heroActions}>
            <Link href="/games" className={styles.heroCta}>
              {t("استكشف الألعاب", "Explore Games")}
              <Arrow />
            </Link>

            <Link href="/ai" className={styles.heroGhost}>
              {t("جرّب GameVortex AI", "Try GameVortex AI")}
            </Link>
          </div>
        </div>

        <div className={styles.heroStats}>
          <div className={styles.heroStat}>
            <StatIcon>🎮</StatIcon>
            <span>
              <b>{formatCount(gamesCount)}</b>
              <small>{t("ألعاب", "Games")}</small>
            </span>
          </div>

          <div className={styles.heroStat}>
            <StatIcon>▦</StatIcon>
            <span>
              <b>{formatCount(appsCount)}</b>
              <small>{t("تطبيقات", "Apps")}</small>
            </span>
          </div>

          <div className={styles.heroStat}>
            <StatIcon>✦</StatIcon>
            <span>
              <b>{t("منتجات رقمية", "Digital Products")}</b>
              <small>{t("متجر GameVortex", "GameVortex Store")}</small>
            </span>
          </div>

          <div className={styles.heroStat}>
            <StatIcon>♛</StatIcon>
            <span>
              <b>VIP</b>
              <small>{t("مزايا حصرية", "Exclusive Benefits")}</small>
            </span>
          </div>

          <div className={styles.heroStat}>
            <StatIcon>✧</StatIcon>
            <span>
              <b>{t("أدوات AI", "AI Tools")}</b>
              <small>{t("مدعومة بالذكاء الاصطناعي", "Powered by AI")}</small>
            </span>
          </div>
        </div>
      </section>

      <div className={styles.sideCol} aria-label={t("بوابات GameVortex", "GameVortex gateways")}>
        {portals.map((portal) => (
          <Link key={portal.href} href={portal.href} className={styles.sideCard}>
            <div className={styles.sideCardContent}>
              <span className={styles.sideKicker}>{portal.icon} {portal.kicker}</span>
              <h3>{english ? portal.titleEn : portal.titleAr}</h3>
              <p>{english ? portal.textEn : portal.textAr}</p>
              <span className={styles.sideBtn}>
                {t("استكشف", "Explore")}
                <Arrow />
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
