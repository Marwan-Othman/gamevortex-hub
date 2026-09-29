export const dynamic = "force-dynamic";

import Link from "next/link";
import { db } from "../lib/prisma";
import styles from "./home.module.css";
import HeroCarousel from "@/components/home/HeroCarousel";
import GameRow from "@/components/home/GameRow";
import LocaleText from "@/components/ui/LocaleText";

const I = (d: string) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d={d} />
  </svg>
);

const icons = {
  all: I(
    "M6 12h4M8 10v4M15 11h.01M17 13h.01M7 6h10a4 4 0 0 1 4 4v4a4 4 0 0 1-4 4h-1l-2-2h-4l-2 2H7a4 4 0 0 1-4-4v-4a4 4 0 0 1 4-4Z"
  ),

  pc: I("M3 5h18v11H3zM8 20h8M12 16v4"),

  mobile: I(
    "M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM11 18h2"
  ),

  ps: I(
    "M9 3v16l3 1V6c3 1 5 2 5 5 0 2-1 3-3 3v3c5 0 7-3 7-6 0-5-5-7-12-8Z"
  ),

  xbox: I(
    "M5 6c3 1 5 4 7 6 2-2 4-5 7-6M5 18c0-4 3-7 7-7s7 3 7 7"
  ),

  nintendo: I(
    "M8 3h8a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3ZM9 8h.01M15 16h.01"
  ),

  gift: I(
    "M3 9h18v4H3zM5 13v8h14v-8M12 9v12M12 9c-3 0-5-4-2-4 2 0 2 4 2 4Zm0 0c3 0 5-4 2-4-2 0-2 4-2 4Z"
  ),

  apps: I(
    "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"
  ),

  more: I("M5 12h.01M12 12h.01M19 12h.01"),

  fire: I(
    "M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 3 0 3 0-3-1-5 1-9Z"
  ),

  pad: I(
    "M6 12h4M8 10v4M15 11h.01M17 13h.01M7 6h10a4 4 0 0 1 4 4v4a4 4 0 0 1-4 4h-1l-2-2h-4l-2 2H7a4 4 0 0 1-4-4v-4a4 4 0 0 1 4-4Z"
  ),

  clock: I(
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 3"
  ),

  star: I(
    "m12 2 2.9 6 6.6.9-4.8 4.6 1.1 6.5-6-3.1-6 3.1 1.1-6.5L2 8.9l6.6-.9z"
  ),

  bolt: I("M13 2 4 14h6l-1 8 9-12h-6z"),

  wallpaper: I(
    "M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2ZM8 10h.01M4 17l4-4 3 3 3-3 6 6"
  ),
};

const PILLS = [
  {
    ar: "الكل",
    en: "All",
    href: "/games",
    icon: icons.all,
    active: true,
  },
  {
    ar: "ألعاب PC",
    en: "PC Games",
    href: "/games?platform=pc",
    icon: icons.pc,
  },
  {
    ar: "ألعاب الموبايل",
    en: "Mobile Games",
    href: "/games?platform=android",
    icon: icons.mobile,
  },
  {
    ar: "PlayStation",
    en: "PlayStation",
    href: "/games?platform=playstation",
    icon: icons.ps,
  },
  {
    ar: "Xbox",
    en: "Xbox",
    href: "/games?platform=xbox",
    icon: icons.xbox,
  },
  {
    ar: "Nintendo",
    en: "Nintendo",
    href: "/games?platform=nintendo",
    icon: icons.nintendo,
  },
  {
    ar: "بطاقات الهدايا",
    en: "Gift Cards",
    href: "/gift-cards",
    icon: icons.gift,
    gold: true,
  },
  {
    ar: "التطبيقات",
    en: "Apps",
    href: "/apps",
    icon: icons.apps,
  },
  {
    ar: "الخلفيات",
    en: "Wallpapers",
    href: "/wallpapers",
    icon: icons.wallpaper,
  },
  {
    ar: "المزيد",
    en: "More",
    href: "/categories",
    icon: icons.more,
  },
];

const GENRES = [
  ["أكشن", "Action", "⚔"],
  ["مغامرات", "Adventure", "✦"],
  ["RPG", "RPG", "✧"],
  ["إطلاق نار", "Shooter", "◎"],
  ["سباقات", "Racing", "ϟ"],
  ["رياضة", "Sports", "◉"],
  ["محاكاة", "Simulation", "✈"],
  ["استراتيجية", "Strategy", "♟"],
  ["رعب", "Horror", "☠"],
  ["إندي", "Indie", "❖"],
  ["عالم مفتوح", "Open World", "◈"],
  ["بقاء", "Survival", "⚑"],
] as const;

const Arrow = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    aria-hidden="true"
  >
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export default async function Home() {
  const [
    newest,
    rated,
    played,
    apps,
    gamesCount,
    appsCount,
  ] = await Promise.all([
    db.game.findMany({
      where: {
        published: true,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 10,
    }),

    db.game.findMany({
      where: {
        published: true,
      },
      orderBy: [
        {
          ratingAverage: "desc",
        },
        {
          ratingCount: "desc",
        },
      ],
      take: 10,
    }),

    db.game.findMany({
      where: {
        published: true,
      },
      orderBy: [
        {
          playCount: "desc",
        },
        {
          viewCount: "desc",
        },
      ],
      take: 10,
    }),

    db.app.findMany({
      where: {
        published: true,
      },
      orderBy: [
        {
          featured: "desc",
        },
        {
          createdAt: "desc",
        },
      ],
      take: 6,
    }),

    db.game.count({
      where: {
        published: true,
      },
    }),

    db.app.count({
      where: {
        published: true,
      },
    }),
  ]);

  return (
    <main className={styles.page}>
      <HeroCarousel
        gamesCount={gamesCount}
        appsCount={appsCount}
      />

      {/* Category pills */}
      <section
        className={styles.section}
        aria-label="Categories"
      >
        <div className={styles.pillRow}>
          {PILLS.map((p) => (
            <Link
              key={p.en}
              href={p.href}
              className={`${styles.pill} ${
                p.active
                  ? styles.pillActive
                  : ""
              } ${
                p.gold
                  ? styles.pillGold
                  : ""
              }`}
            >
              {p.icon}

              <LocaleText
                ar={p.ar}
                en={p.en}
              />
            </Link>
          ))}
        </div>
      </section>

      {/* Trending games + Hot deals */}
      <div className={styles.split}>
        <GameRow
          title="الأكثر لعبًا"
          icon={icons.fire}
          href="/games?sort=popular"
          games={played}
        />

        <div className={styles.dealCard}>
          <small>HOT DEALS</small>

          <LocaleText
            as="h2"
            ar="عروض ساخنة"
            en="HOT DEALS"
          />

          <LocaleText
            as="p"
            ar="عروض لفترة محدودة على الألعاب وبطاقات الهدايا"
            en="Limited time offers on Games & Gift Cards"
          />

          <Link
            href="/marketplace"
            className={styles.dealBtn}
          >
            <LocaleText
              ar="تسوّق العروض"
              en="Shop Deals"
            />
          </Link>
        </div>
      </div>

      {/* Popular categories */}
      <section
        className={styles.section}
        aria-label="Popular categories"
      >
        <div className={styles.sectionHead}>
          <h2>
            {icons.pad}

            <LocaleText
              ar="التصنيفات الشائعة"
              en="Popular Categories"
            />
          </h2>

          <Link href="/games">
            <LocaleText
              ar="عرض الكل ←"
              en="View All →"
            />
          </Link>
        </div>

        <div className={styles.genreGrid}>
          {GENRES.map(
            ([ar, en, sym]) => (
              <Link
                key={en}
                href={`/games?genre=${encodeURIComponent(
                  en
                )}`}
                className={
                  styles.genreTile
                }
              >
                <b
                  className={
                    styles.genreSym
                  }
                >
                  {sym}
                </b>

                <span>
                  <LocaleText
                    ar={ar}
                    en={en}
                  />
                </span>
              </Link>
            )
          )}
        </div>
      </section>

      {/* Promo trio */}
      <div className={styles.promoGrid}>
        <div className={styles.promoCard}>
          <h3>
            {icons.pc}

            <LocaleText
              ar="ألعاب PC"
              en="PC Games"
            />
          </h3>

          <Link
            href="/games?platform=pc"
            className={styles.promoBtn}
          >
            <LocaleText
              ar="تصفح ألعاب PC"
              en="Browse PC Games"
            />

            <Arrow />
          </Link>
        </div>

        <div
          className={`${styles.promoCard} ${styles.promoGold}`}
        >
          <h3>
            {icons.mobile}

            <LocaleText
              ar="ألعاب الموبايل"
              en="Mobile Games"
            />
          </h3>

          <Link
            href="/games?platform=android"
            className={styles.promoBtn}
          >
            <LocaleText
              ar="تصفح ألعاب الموبايل"
              en="Browse Mobile Games"
            />

            <Arrow />
          </Link>
        </div>

        <div className={styles.promoCard}>
          <h3>
            {icons.gift}

            <LocaleText
              ar="بطاقات الهدايا"
              en="Gift Cards"
            />
          </h3>

          <Link
            href="/gift-cards"
            className={styles.promoBtn}
          >
            <LocaleText
              ar="عرض بطاقات الهدايا"
              en="View Gift Cards"
            />

            <Arrow />
          </Link>
        </div>
      </div>

      {/* Top rated */}
      <GameRow
        title="الأعلى تقييمًا"
        icon={icons.star}
        href="/games?sort=rating"
        games={rated}
      />

      {/* New games */}
      <GameRow
        title="أحدث الألعاب"
        icon={icons.clock}
        href="/games?sort=newest"
        games={newest}
      />

      {/* Apps */}
      {apps.length > 0 && (
        <section
          className={styles.section}
        >
          <div
            className={
              styles.sectionHead
            }
          >
            <h2>
              {icons.apps}

              <LocaleText
                ar="التطبيقات"
                en="Apps"
              />
            </h2>

            <Link href="/apps">
              <LocaleText
                ar="عرض الكل ←"
                en="View All →"
              />
            </Link>
          </div>

          <div className="grid">
            {apps.map((app) => (
              <Link
                href={`/apps/${app.slug}`}
                className="glass card"
                key={app.id}
              >
                <span className="badge">
                  APP
                </span>

                <h3>
                  {app.nameAr}
                </h3>

                <p className="muted">
                  {app.nameEn}
                  {app.developer
                    ? ` · ${app.developer}`
                    : ""}
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Wallpapers */}
      <section className={styles.wallpaperWide} aria-label="GameVortex Wallpapers">
        <div className={styles.wallpaperWideArt} aria-hidden="true" />
        <div className={styles.wallpaperWideContent}>
          <span className={styles.wallpaperWideBadge}>🖼️ GAMEVORTEX WALLPAPERS</span>
          <LocaleText
            as="h2"
            ar="خلفيات Gaming لهاتفك وكمبيوترك"
            en="Gaming wallpapers for your phone and PC"
          />
          <LocaleText
            as="p"
            ar="اكتشف خلفيات مميزة، اختر المقاس المناسب، وحمّلها مباشرة."
            en="Discover featured wallpapers, choose your device, and download directly."
          />
        </div>
        <Link href="/wallpapers" className={styles.wallpaperWideBtn}>
          <LocaleText ar="استكشف الخلفيات" en="Explore wallpapers" />
          <Arrow />
        </Link>
      </section>

      {/* VIP banner */}
      <section
        className={styles.vipWide}
        aria-label="GameVortex VIP"
      >
        <div>
          <span
            className={
              styles.vipBadge
            }
          >
            ♛ GAMEVORTEX VIP
          </span>

          <LocaleText
            as="h2"
            ar="انضم إلى GameVortex VIP"
            en="Join GameVortex VIP"
          />

          <LocaleText
            as="p"
            ar="مكافآت حصرية، نقاط أعلى، رصيد AI، عروض خاصة وأكثر."
            en="Get exclusive rewards, higher points, AI credits, special offers and more."
          />
        </div>

        <Link
          href="/vip"
          className={styles.vipBtn}
        >
          <LocaleText
            ar="الترقية إلى VIP"
            en="Upgrade to VIP"
          />

          <Arrow />
        </Link>
      </section>
    </main>
  );
}
