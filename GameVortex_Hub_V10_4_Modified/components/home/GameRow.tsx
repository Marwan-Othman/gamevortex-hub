import Link from "next/link";
import styles from "../../app/home.module.css";
import { vortexScore } from "../../lib/game-score";

type Game = {
  id: string;
  slug: string;
  titleAr: string;
  titleEn: string;
  coverUrl: string | null;
  platform: string | null;
  ratingAverage: number;
  ratingCount: number;
  playCount: number;
  viewCount: number;
  featured: boolean;
};

function platformLabel(platform: string | null) {
  const first = (platform || "").split(",")[0]?.trim();
  return first || "Multi";
}

export default function GameRow({ title, icon, href, games }: { title: string; icon: React.ReactNode; href: string; games: Game[] }) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2>{icon}{title}</h2>
        <Link href={href}>عرض الكل ←</Link>
      </div>
      <div className={styles.hscroll}>
        {games.map((g) => (
          <Link key={g.id} href={`/games/${g.slug}`} className={styles.gameCard}>
            <div className={styles.gameCoverWrap}>
              {g.coverUrl && <img src={g.coverUrl} alt={g.titleEn} loading="lazy" />}
              <span className={styles.platformBadge}>{platformLabel(g.platform)}</span>
            </div>
            <div className={styles.gameInfo}>
              <div className={styles.gameRating}>★ {g.ratingAverage.toFixed(1)} · VORTEX {vortexScore(g)}</div>
              <p className={styles.gameTitle}>{g.titleAr}</p>
            </div>
          </Link>
        ))}
        {!games.length && <p className="muted" style={{ padding: "0 4px" }}>لا توجد بيانات كافية حاليًا.</p>}
      </div>
    </section>
  );
}
