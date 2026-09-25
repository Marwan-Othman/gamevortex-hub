export const dynamic = "force-dynamic";

import Link from "next/link";
import { db } from "../../lib/prisma";
import { vortexScore } from "../../lib/game-score";
import {
  GAME_PLATFORMS,
  normalizePlatform,
  getPlatformName,
  getPlatformEnum,
  getPlatformSlugFromEnum,
} from "../../lib/platforms";

type Props = {
  searchParams: Promise<{
    q?: string;
    platform?: string;
    genre?: string;
    sort?: string;
  }>;
};

export default async function Games({
  searchParams,
}: Props) {
  const params = await searchParams;

  const q = (params.q || "").trim().slice(0, 80);
  const platform = (params.platform || "")
    .trim()
    .slice(0, 60);
  const genre = (params.genre || "")
    .trim()
    .slice(0, 60);

  const sort =
    params.sort === "popular" ||
    params.sort === "newest"
      ? params.sort
      : "rating";

  const normalizedPlatform =
    normalizePlatform(platform);

  const platformEnum =
    getPlatformEnum(normalizedPlatform);

  const where = {
    published: true,

    ...(platformEnum
      ? {
          gamePlatforms: {
            some: {
              platform: platformEnum,
            },
          },
        }
      : {}),

    ...(genre
      ? {
          genre: {
            equals: genre,
            mode: "insensitive" as const,
          },
        }
      : {}),

    ...(q
      ? {
          OR: [
            {
              titleAr: {
                contains: q,
                mode: "insensitive" as const,
              },
            },
            {
              titleEn: {
                contains: q,
                mode: "insensitive" as const,
              },
            },
            {
              description: {
                contains: q,
                mode: "insensitive" as const,
              },
            },
          ],
        }
      : {}),
  };

  const orderBy =
    sort === "popular"
      ? [
          {
            playCount: "desc" as const,
          },
          {
            viewCount: "desc" as const,
          },
        ]
      : sort === "newest"
        ? [
            {
              createdAt: "desc" as const,
            },
          ]
        : [
            {
              featured: "desc" as const,
            },
            {
              ratingAverage: "desc" as const,
            },
            {
              ratingCount: "desc" as const,
            },
          ];

  const [games, genres] = await Promise.all([
    db.game.findMany({
      where,
      orderBy,
      take: 60,
      include: {
        gamePlatforms: true,
      },
    }),

    db.game.findMany({
      where: {
        published: true,
      },
      select: {
        genre: true,
      },
      distinct: ["genre"],
      orderBy: {
        genre: "asc",
      },
    }),
  ]);

  const genreValues = [
    ...new Set(
      genres
        .map((item) => item.genre)
        .filter(
          (value): value is string =>
            Boolean(value),
        ),
    ),
  ];

  function buildPlatformHref(
    platformSlug?: string,
  ) {
    const search = new URLSearchParams();

    if (q) {
      search.set("q", q);
    }

    if (platformSlug) {
      search.set("platform", platformSlug);
    }

    if (genre) {
      search.set("genre", genre);
    }

    if (sort !== "rating") {
      search.set("sort", sort);
    }

    const query = search.toString();

    return query
      ? `/games?${query}`
      : "/games";
  }

  return (
    <main className="wrap">
      <section className="glass hero">
        <p className="muted">
          GAME DISCOVERY
        </p>

        <h1>اكتشف عالم الألعاب</h1>

        <p>
          اكتشف ألعابًا لجميع المنصات مع البحث
          والفلترة والترتيب من الخادم وVortex Score.
        </p>

        <div className="platform-list">
          <Link
            href={buildPlatformHref()}
            className={`platform-chip ${
              !normalizedPlatform
                ? "active"
                : ""
            }`}
          >
            <span className="platform-icon">
              🎮
            </span>

            <span>كل المنصات</span>
          </Link>

          {GAME_PLATFORMS.map((item) => {
            const isActive =
              normalizedPlatform === item.slug;

            return (
              <Link
                key={item.slug}
                href={buildPlatformHref(
                  item.slug,
                )}
                className={`platform-chip ${
                  isActive ? "active" : ""
                }`}
              >
                <span className="platform-icon">
                  {item.icon}
                </span>

                <span>
                  {getPlatformName(
                    item.slug,
                    "ar",
                  )}
                </span>
              </Link>
            );
          })}
        </div>

        <form
          className="glass card filters"
          method="get"
        >
          <input
            className="input"
            name="q"
            defaultValue={q}
            maxLength={80}
            placeholder="ابحث باسم اللعبة..."
            aria-label="بحث عن لعبة"
          />

          <div className="filter-row">
            <select
              className="input"
              name="platform"
              defaultValue={
                normalizedPlatform ?? ""
              }
              aria-label="المنصة"
            >
              <option value="">
                كل المنصات
              </option>

              {GAME_PLATFORMS.map((item) => (
                <option
                  key={item.slug}
                  value={item.slug}
                >
                  {item.nameAr}
                </option>
              ))}
            </select>

            <select
              className="input"
              name="genre"
              defaultValue={genre}
              aria-label="النوع"
            >
              <option value="">
                كل الأنواع
              </option>

              {genreValues.map((value) => (
                <option
                  key={value}
                  value={value}
                >
                  {value}
                </option>
              ))}
            </select>

            <select
              className="input"
              name="sort"
              defaultValue={sort}
              aria-label="الترتيب"
            >
              <option value="rating">
                الأعلى تقييمًا
              </option>

              <option value="popular">
                الأكثر لعبًا
              </option>

              <option value="newest">
                الأحدث
              </option>
            </select>

            <button
              className="btn"
              type="submit"
            >
              بحث
            </button>
          </div>
        </form>
      </section>

      <p className="muted" style={{ marginTop: "14px", fontSize: "13px" }}>
        بيانات الألعاب المستوردة من RAWG تستخدم وفق شروط المصدر، مع روابط المتاجر الرسمية عند توفرها. <a href="https://rawg.io" target="_blank" rel="noreferrer">RAWG</a>
      </p>

      <div className="grid">
        {games.map((game) => (
          <Link
            href={`/games/${game.slug}`}
            key={game.id}
            className="glass card game-card"
          >
            {game.coverUrl && (
              <img
                className="cover"
                src={game.coverUrl}
                alt={game.titleEn}
                loading="lazy"
              />
            )}

            <div className="card-top">
              <span className="badge">
                VORTEX {vortexScore(game)}
              </span>

              <span className="muted">
                ★{" "}
                {game.ratingAverage.toFixed(1)}
              </span>
            </div>

            <h2>{game.titleAr}</h2>

            <p>{game.titleEn}</p>

            <div className="game-platform-list">
              {game.gamePlatforms.length > 0 ? (
                game.gamePlatforms.map(
                  (item) => {
                    const slug =
                      getPlatformSlugFromEnum(
                        item.platform,
                      );

                    const info =
                      GAME_PLATFORMS.find(
                        (platformItem) =>
                          platformItem.slug ===
                          slug,
                      );

                    return (
                      <span
                        className="game-platform"
                        key={item.platform}
                      >
                        <span className="platform-icon">
                          {info?.icon || "🎮"}
                        </span>

                        <span>
                          {info?.nameAr ||
                            item.platform}
                        </span>
                      </span>
                    );
                  },
                )
              ) : (
                <span className="game-platform">
                  <span className="platform-icon">
                    🎮
                  </span>

                  <span>
                    {game.platform
                      ? getPlatformName(
                          normalizePlatform(
                            game.platform,
                          ),
                          "ar",
                        )
                      : "متعدد المنصات"}
                  </span>
                </span>
              )}
            </div>

            <p className="muted">
              {game.genre || "Gaming"} ·{" "}
              {game.playCount} لعب
            </p>
          </Link>
        ))}
      </div>

      {!games.length && (
        <section className="glass card">
          <h2>لا توجد نتائج</h2>

          <p className="muted">
            جرّب تغيير البحث أو الفلاتر.
          </p>
        </section>
      )}
    </main>
  );
}
