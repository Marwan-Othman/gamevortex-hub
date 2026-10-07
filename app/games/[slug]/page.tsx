export const dynamic = "force-dynamic";

import Link from "next/link";
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

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;

  const game = await db.game.findFirst({
    where: {
      slug,
      published: true,
    },
    select: {
      titleAr: true,
      titleEn: true,
      description: true,
      coverUrl: true,
      slug: true,
    },
  });

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

export default async function GameDetails({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const game = await db.game.findFirst({
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
  });

  if (!game) {
    notFound();
  }

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
          />
        )}

        <div>
          <span className="badge">
            VORTEX SCORE {score}
          </span>

          <h1>{game.titleAr}</h1>

          <p className="muted">
            {game.titleEn}
          </p>

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

          {game.downloadSource && (
            <a
              className="btn"
              href={`/download/game/${game.slug}`}
            >
              تحميل اللعبة
            </a>
          )}

          {game.officialUrl && (
            <a
              className="btn secondary"
              href={game.officialUrl}
              target="_blank"
              rel="noreferrer"
            >
              الموقع الرسمي
            </a>
          )}
        </div>
      </section>

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
