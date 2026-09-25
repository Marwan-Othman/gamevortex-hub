export const dynamic = "force-dynamic";

import Link from "next/link";
import { db } from "../lib/prisma";
import styles from "./home.module.css";
import HeroCarousel from "@/components/home/HeroCarousel";
import PlatformRow from "@/components/home/PlatformRow";
import CategoriesRow from "@/components/home/CategoriesRow";
import VipBanner from "@/components/home/VipBanner";
import GameRow from "@/components/home/GameRow";

const NewestIcon = (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 3" />
  </svg>
);

const RatedIcon = (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="currentColor"
  >
    <path d="m12 2 2.9 6 6.6.9-4.8 4.6 1.1 6.5-6-3.1-6 3.1 1.1-6.5L2 8.9l6.6-.9z" />
  </svg>
);

const PopularIcon = (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
  >
    <path d="M13 2 4 14h6l-1 8 9-12h-6z" />
  </svg>
);


const VIPIcon = (
  <svg
    width="22"
    height="22"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
  >
    <path d="m4 8 3 3 5-7 5 7 3-3-2 11H6L4 8Z" />
    <path d="M6 19h12" />
    <path d="M8 15h8" />
  </svg>
);

export default async function Home() {
  const [newest, rated, played] = await Promise.all([
    db.game.findMany({
      where: { published: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),

    db.game.findMany({
      where: { published: true },
      orderBy: [
        { ratingAverage: "desc" },
        { ratingCount: "desc" },
      ],
      take: 10,
    }),

    db.game.findMany({
      where: { published: true },
      orderBy: [
        { playCount: "desc" },
        { viewCount: "desc" },
      ],
      take: 10,
    }),
  ]);

  return (
    <main className={styles.page}>
      <HeroCarousel />

      <PlatformRow />

      <GameRow
        title="أحدث الألعاب"
        icon={NewestIcon}
        href="/games?sort=newest"
        games={newest}
      />

      <CategoriesRow />

      <section className={styles.vipHomeSection} dir="rtl">
        <div className={styles.vipHomeGlow} />
        <div className={styles.vipHomeGrid}>
          <Link href="/vip" className={styles.vipHomeCard}>
            <div className={styles.homeCardIcon}>
              {VIPIcon}
            </div>
            <div className={styles.homeCardContent}>
              <span className={styles.homeCardLabel}>GAMEVORTEX VIP</span>
              <h2>مزايا أكثر. نقاط أكثر.</h2>
              <p>احصل على مضاعفات نقاط ومزايا حصرية مع باقات GameVortex VIP.</p>
            </div>
            <span className={styles.homeCardArrow}>←</span>
          </Link>
        </div>
      </section>

      <VipBanner />

      <GameRow
        title="الأعلى تقييمًا"
        icon={RatedIcon}
        href="/games?sort=rating"
        games={rated}
      />

      <GameRow
        title="الأكثر لعبًا"
        icon={PopularIcon}
        href="/games?sort=popular"
        games={played}
      />
    </main>
  );
}
