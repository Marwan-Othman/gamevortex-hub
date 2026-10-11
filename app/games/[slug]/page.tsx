export const dynamic = "force-dynamic";

import { cache } from "react";
import Link from "next/link";
import { canDownload } from "@/lib/downloads";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { db } from "../../../lib/prisma";
import { vortexScore } from "../../../lib/game-score";
import GameActions from "@/components/games/GameActions";
import ReviewForm from "@/components/games/ReviewForm";
import {
  GAME_PLATFORMS,
  getPlatformSlugFromEnum,
} from "@/lib/platforms";

/**
 * One query per request: generateMetadata() and the page both need this game. React's cache()
 * de-duplicates the call inside a single render pass (previously two separate DB round-trips).
 */
const getGame = cache(async (slug: string) =>
  db.game.findFirst({
    where: {
      slug,
      published: true,
    },

    include: {
      gamePlatforms: true,

      gameCategories: {
        include: {
          category: true,
        },
      },

      reviews: {
        orderBy: {
          createdAt: "desc",
        },

        take: 8,

        include: {
          user: {
            select: {
              username: true,
            },
          },
        },
      },
    },
  }),
);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;

  const game = await getGame(slug);

  if (!game) {
    return {
      title: "اللعبة غير موجودة | GameVortex Hub",
    };
  }

  const title = `${game.titleAr} | GameVortex Hub`;

  const description = (
    game.description ||
    `اكتشف ${game.titleEn} على GameVortex Hub.`
  ).slice(0, 160);

  const base =
    process.env.APP_ORIGIN?.trim() ||
    "http://localhost:3000";

  const canonical = `${base}/games/${game.slug}`;

  return {
    title,
    description,

    alternates: {
      canonical,
    },

    openGraph: {
      title,
      description,
      url: canonical,
      type: "website",
      images: game.coverUrl
        ? [
            {
              url: game.coverUrl,
            },
          ]
        : [],
    },
  };
}

/** Only plain http(s) links are rendered as hrefs (blocks javascript:/data: values from bad data). */
function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export default async function GameDetails({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const game = await getGame(slug);

  if (!game) {
    notFound();
  }

  // The view counter (shown here and used by "most viewed" sorting) only moved through the API before.
  // Best effort: a failed counter update must never break the page.
  void db.game
    .update({ where: { id: game.id }, data: { viewCount: { increment: 1 } } })
    .catch(() => undefined);

  const officialUrl = safeHttpUrl(game.officialUrl);
  const downloadable = canDownload(game);

  const relatedCategoryIds = game.gameCategories.map(
    (item) => item.categoryId,
  );

  const relatedGames = relatedCategoryIds.length
    ? await db.game.findMany({
        where: {
          published: true,
          id: {
            not: game.id,
          },
          gameCategories: {
            some: {
              categoryId: {
                in: relatedCategoryIds,
              },
            },
          },
        },
        orderBy: [
          { ratingAverage: "desc" },
          { ratingCount: "desc" },
        ],
        take: 6,
      })
    : [];

  const score = vortexScore(game);

  const platformItems = game.gamePlatforms
    .map((item) => {
      const slug = getPlatformSlugFromEnum(
        item.platform,
      );

      if (!slug) {
        return null;
      }

      return (
        GAME_PLATFORMS.find(
          (platform) =>
            platform.slug === slug,
        ) ?? null
      );
    })
    .filter(
      (
        platform,
      ): platform is (typeof GAME_PLATFORMS)[number] =>
        Boolean(platform),
    );

  return (
    <main className="wrap">
      <Link
        href="/games"
        className="muted"
      >
        ← العودة للألعاب
      </Link>

      <section className="glass hero game-detail">
        {game.coverUrl && (
          <img
            className="detail-cover"
            src={game.coverUrl}
            alt={game.titleEn}
            // Above-the-fold cover is the LCP element: fetch it first, never lazy.
            fetchPriority="high"
            decoding="async"
          />
        )}

        <div>
          <span className="badge">
            VORTEX SCORE {score}
          </span>
          {game.isMod && <span className="badge">MOD</span>}
          {game.version && <span className="badge" dir="ltr">v{game.version.replace(/^v/i, "")}</span>}

          <h1>{game.titleAr}</h1>

          {game.titleEn && game.titleEn !== game.titleAr && (
            <p className="muted">
              {game.titleEn}
            </p>
          )}

          <p>
            {game.description ||
              "لا يوجد وصف بعد."}
          </p>

          {platformItems.length > 0 ? (
            <div
              className="game-platform-list"
              style={{
                marginTop: "16px",
                marginBottom: "16px",
              }}
            >
              {platformItems.map(
                (platform) => (
                  <Link
                    key={platform.slug}
                    href={`/games?platform=${encodeURIComponent(
                      platform.slug,
                    )}`}
                    className="game-platform"
                  >
                    <span
                      className="platform-icon"
                      aria-hidden="true"
                    >
                      {platform.icon}
                    </span>

                    <span>
                      {platform.nameAr}
                    </span>
                  </Link>
                ),
              )}
            </div>
          ) : (
            <div
              className="game-platform-list"
              style={{
                marginTop: "16px",
                marginBottom: "16px",
              }}
            >
              <span className="game-platform">
                <span
                  className="platform-icon"
                  aria-hidden="true"
                >
                  🎮
                </span>

                <span>
                  {game.platform ||
                    "منصات متعددة"}
                </span>
              </span>
            </div>
          )}

          <div className="stat-row">
            <span>
              {game.gameCategories[0]?.category.nameAr || game.genre || "ألعاب"}
            </span>

            <span>
              ★{" "}
              {game.ratingAverage.toFixed(1)}{" "}
              ({game.ratingCount})
            </span>

            <span>
              👁 {game.viewCount}
            </span>

            <span>
              ▶ {game.playCount}
            </span>
          </div>

          {downloadable && (
            <a
              className="btn"
              href={`/download/game/${game.slug}`}
            >
              تحميل اللعبة
            </a>
          )}

          {officialUrl && (
            <a
              className="btn secondary"
              href={officialUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              الموقع الرسمي
            </a>
          )}

          {!downloadable && !officialUrl && (
            <p className="muted">
              التحميل غير متاح لهذه اللعبة حاليًا.
            </p>
          )}
        </div>
      </section>

      {game.screenshots.length > 0 && (
        <section className="glass card" style={{ marginTop: 16 }}>
          <h2>صور من داخل اللعبة</h2>
          <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 8 }}>
            {game.screenshots.map((src) => (
              <img
                key={src}
                src={src}
                alt=""
                loading="lazy"
                decoding="async"
                style={{ height: 220, width: "auto", borderRadius: 14, flex: "0 0 auto" }}
              />
            ))}
          </div>
        </section>
      )}


      {relatedGames.length > 0 && (
        <section>
          <h2>ألعاب ذات صلة</h2>

          <div className="grid">
            {relatedGames.map((related) => (
              <Link
                href={`/games/${related.slug}`}
                className="glass card"
                key={related.id}
              >
                {related.coverUrl && (
                  <img
                    src={related.coverUrl}
                    alt={related.titleEn}
                    loading="lazy"
                    decoding="async"
                    style={{
                      width: "100%",
                      borderRadius: 12,
                      marginBottom: 8,
                    }}
                  />
                )}

                <h3>{related.titleAr}</h3>

                <p className="muted">
                  {related.titleEn}
                </p>

                <p>
                  ★ {related.ratingAverage.toFixed(1)}{" "}
                  ({related.ratingCount})
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}

      <GameActions gameId={game.id} />

      <ReviewForm slug={slug} />

      <section>
        <h2>آخر المراجعات</h2>

        <div className="grid">
          {game.reviews.length ? (
            game.reviews.map((review) => (
              <article
                className="glass card"
                key={review.id}
              >
                <strong>
                  {review.user.username ||
                    "Gamer"}
                </strong>

                <p>
                  ★ {review.rating}/5
                </p>

                <p className="muted">
                  {review.text ||
                    "بدون تعليق"}
                </p>
              </article>
            ))
          ) : (
            <p className="muted">
              لا توجد مراجعات بعد.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
