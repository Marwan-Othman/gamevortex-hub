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

  return (
    <div
      className={styles.heroGrid}
      dir={english ? "ltr" : "rtl"}
      lang={locale}
    >
      {/* =========================================================
          MAIN HERO
          ========================================================= */}
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
        <div
          className={styles.heroArtwork}
          aria-hidden="true"
        />

        <div
          className={styles.heroOverlay}
          aria-hidden="true"
        />

        <div className={styles.heroContent}>
          <span className={styles.heroEyebrow}>
            {t(
              "مرحبًا بك في GAMEVORTEX",
              "WELCOME TO GAMEVORTEX"
            )}
          </span>

          <h1 className={styles.heroTitle}>
            GAMEVORTEX
          </h1>

          <p className={styles.heroTag}>
            {t(
              "العب بلا حدود",
              "PLAY BEYOND LIMITS"
            )}
          </p>

          <p className={styles.heroLead}>
            {t(
              "اكتشف، العب، واستكشف عالم الألعاب المتكامل. ألعاب، تطبيقات، بطاقات هدايا، أدوات ذكاء اصطناعي وأكثر.",
              "Discover, play, and explore the ultimate gaming universe. Games, apps, gift cards, AI tools and more."
            )}
          </p>

          <div className={styles.heroActions}>
            <Link
              href="/games"
              className={styles.heroCta}
            >
              {t(
                "استكشف الألعاب",
                "Explore Games"
              )}

              <Arrow />
            </Link>

            <Link
              href="/auth/register"
              className={styles.heroGhost}
            >
              {t(
                "انضم الآن",
                "Join Now"
              )}
            </Link>
          </div>
        </div>

        {/* =======================================================
            HERO STATS
            ======================================================= */}
        <div className={styles.heroStats}>
          <div className={styles.heroStat}>
            <StatIcon>
              🎮
            </StatIcon>

            <span>
              <b>
                {formatCount(gamesCount)}
              </b>

              <small>
                {t(
                  "ألعاب",
                  "Games"
                )}
              </small>
            </span>
          </div>

          <div className={styles.heroStat}>
            <StatIcon>
              ▦
            </StatIcon>

            <span>
              <b>
                {formatCount(appsCount)}
              </b>

              <small>
                {t(
                  "تطبيقات",
                  "Apps"
                )}
              </small>
            </span>
          </div>

          <div className={styles.heroStat}>
            <StatIcon>
              ✦
            </StatIcon>

            <span>
              <b>
                {t(
                  "منتجات رقمية",
                  "Digital Products"
                )}
              </b>

              <small>
                {t(
                  "متجر GameVortex",
                  "GameVortex Store"
                )}
              </small>
            </span>
          </div>

          <div className={styles.heroStat}>
            <StatIcon>
              ♛
            </StatIcon>

            <span>
              <b>
                VIP
              </b>

              <small>
                {t(
                  "مزايا حصرية",
                  "Exclusive Benefits"
                )}
              </small>
            </span>
          </div>

          <div className={styles.heroStat}>
            <StatIcon>
              ✧
            </StatIcon>

            <span>
              <b>
                {t(
                  "أدوات AI",
                  "AI Tools"
                )}
              </b>

              <small>
                {t(
                  "مدعومة بالذكاء الاصطناعي",
                  "Powered by AI"
                )}
              </small>
            </span>
          </div>
        </div>
      </section>

      {/* =========================================================
          SIDE BANNERS
          ========================================================= */}
      <div className={styles.sideCol}>

        {/* =======================================================
            VIP BANNER
            ======================================================= */}
        <Link
          href="/vip"
          className={`${styles.sideCard} ${styles.sideVip}`}
          aria-label={t(
            "عرض باقات GameVortex VIP",
            "View GameVortex VIP Plans"
          )}
          style={
            {
              backgroundImage:
                "url('/images/home/vip-banner.png')",
              backgroundSize: "cover",
              backgroundPosition: "center",
              backgroundRepeat: "no-repeat",
            } as React.CSSProperties
          }
        >
          <div className={styles.sideCardContent}>
            <span className={styles.sideKicker}>
              GAMEVORTEX VIP
            </span>

            <h3>
              {t(
                "GameVortex VIP",
                "GameVortex VIP"
              )}{" "}
              ♛
            </h3>

            <p>
              {t(
                "مكافآت حصرية • نقاط أعلى • رصيد AI • عروض خاصة",
                "Exclusive rewards • Higher points • AI credits • Special offers"
              )}
            </p>

            <span className={styles.sideBtn}>
              {t(
                "عرض باقات VIP",
                "View VIP Plans"
              )}

              <Arrow />
            </span>
          </div>
        </Link>

        {/* =======================================================
            AI BANNER
            ======================================================= */}
        <Link
          href="/ai"
          className={`${styles.sideCard} ${styles.sideAi}`}
          aria-label={t(
            "ابدأ مع GameVortex AI",
            "Start with GameVortex AI"
          )}
          style={
            {
              backgroundImage:
                "url('/images/home/ai-banner.png')",
              backgroundSize: "cover",
              backgroundPosition: "center",
              backgroundRepeat: "no-repeat",
            } as React.CSSProperties
          }
        >
          <div className={styles.sideCardContent}>
            <span className={styles.sideKicker}>
              GAMEVORTEX AI
            </span>

            <h3>
              {t(
                "GameVortex AI",
                "GameVortex AI"
              )}{" "}
              ✧
            </h3>

            <p>
              {t(
                "محادثة • صور • فيديو • أدوات ألعاب",
                "Chat • Image • Video • Game Tools"
              )}
            </p>

            <span className={styles.sideBtn}>
              {t(
                "ابدأ مع AI",
                "Start with AI"
              )}

              <Arrow />
            </span>
          </div>
        </Link>

      </div>
    </div>
  );
}
