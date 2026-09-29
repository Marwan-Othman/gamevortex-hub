"use client";

import Link from "next/link";
import { useLocale } from "@/components/ui/useLocale";
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

export default function GameRow({
  title,
  icon,
  href,
  games,
}: {
  title: string;
  icon: React.ReactNode;
  href: string;
  games: Game[];
}) {
  const english = useLocale() === "en";
  const translatedTitle = english ? ({ "أحدث الألعاب": "Latest games", "الأعلى تقييمًا": "Top rated", "الأكثر لعبًا": "Most played" } as Record<string, string>)[title] || title : title;
  return (
    <section className={styles.section} aria-label={translatedTitle}>
      <div className={styles.sectionHead}>
        <h2>
          {icon}
          {translatedTitle}
        </h2>

        <Link href={href}>{english ? "View all →" : "عرض الكل ←"}</Link>
      </div>

      <div className={styles.hscroll}>
        {games.map((game) => {
          const score = vortexScore(game);

          return (
            <Link
              key={game.id}
              href={`/games/${game.slug}`}
              className={styles.gameCard}
            >
              <div className={styles.gameCoverWrap}>
                {game.coverUrl ? (
                  <img
                    src={game.coverUrl}
                    alt={game.titleEn}
                    loading="lazy"
                  />
                ) : (
                  <div className={styles.gameCoverFallback}>
                    <span>GAMEVORTEX</span>
                  </div>
                )}

                <span className={styles.platformBadge}>
                  {platformLabel(game.platform)}
                </span>

                {game.featured && (
                  <span className={styles.featuredBadge}>
                    {english ? "Featured" : "مميز"}
                  </span>
                )}

                <span className={styles.coverGlow} />
              </div>

              <div className={styles.gameInfo}>
                <div className={styles.gameMeta}>
                  <span className={styles.gameRating}>
                    ★ {game.ratingAverage.toFixed(1)}
                  </span>

                  <span className={styles.vortexScore}>
                    V {score}
                  </span>
                </div>

                <p className={styles.gameTitle}>
                  {game.titleAr}
                </p>

                <span className={styles.gameEnglishTitle}>
                  {game.titleEn}
                </span>
              </div>
            </Link>
          );
        })}

        {!games.length && (
          <div className={styles.emptyGames}>
            {english ? "No games are available right now." : "لا توجد ألعاب متاحة حاليًا."}
          </div>
        )}
      </div>
    </section>
  );
}
