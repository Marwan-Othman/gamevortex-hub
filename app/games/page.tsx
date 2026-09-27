export const dynamic = "force-dynamic";

import Link from "next/link";
import { db } from "../../lib/prisma";
import { vortexScore } from "../../lib/game-score";
import LocaleText from "@/components/ui/LocaleText";
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
    page?: string;
    limit?: string;
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
  const pageParam = Number(params.page || "1");
  const limitParam = Number(params.limit || "24");
  const page = Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;
  const limit = Number.isFinite(limitParam) && limitParam > 0 && limitParam <= 60 ? Math.floor(limitParam) : 24;

  const sort =
    params.sort === "popular" ||
    params.sort === "views" ||
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
          gameCategories: {
            some: {
              category: {
                OR: [
                  { slug: genre.toLowerCase() },
                  { nameEn: { equals: genre, mode: "insensitive" as const } },
                  { nameAr: { equals: genre, mode: "insensitive" as const } },
                ],
              },
            },
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
          { playCount: "desc" as const },
          { viewCount: "desc" as const },
        ]
      : sort === "views"
        ? [
            { viewCount: "desc" as const },
            { playCount: "desc" as const },
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

  const [games, total, genres] = await Promise.all([
    db.game.findMany({
      where,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
      include: {
        gamePlatforms: true,
        gameCategories: { include: { category: true } },
      },
    }),

    db.game.count({ where }),

    db.category.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { nameEn: "asc" }],
      select: { slug: true, nameAr: true, nameEn: true },
    }),
  ]);

  const genreValues = genres;

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

    // لا نحافظ على رقم الصفحة الحالي هنا: تغيير فلتر المنصة
    // يجب أن يرجع دائمًا إلى الصفحة 1، لأن نتائج الفلتر الجديد
    // قد لا تملك نفس عدد الصفحات.

    const query = search.toString();

    return query
      ? `/games?${query}`
      : "/games";
  }

  function buildPageHref(nextPage: number) {
    const search = new URLSearchParams();
    if (q) search.set("q", q);
    if (normalizedPlatform) search.set("platform", normalizedPlatform);
    if (genre) search.set("genre", genre);
    if (sort !== "rating") search.set("sort", sort);
    if (nextPage > 1) search.set("page", String(nextPage));
    const query = search.toString();
    return query ? `/games?${query}` : "/games";
  }

  return (
    <main className="wrap">
      <section className="glass hero">
        <p className="muted">
          DISCOVER GAMES
        </p>

        <LocaleText as="h1" ar="اكتشف ألعابك القادمة" en="Discover your next game" />

        <p>
          <LocaleText as="span" ar="اكتشف ألعابًا لجميع المنصات مع البحث والفلترة والترتيب من الخادم وVortex Score." en="Explore games across platforms with server-side search, filters, sorting and Vortex Score." />
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

            <LocaleText ar="كل المنصات" en="All platforms" />
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

                <LocaleText ar={getPlatformName(item.slug, "ar")} en={getPlatformName(item.slug, "en")} />
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
            placeholder="Search for games, genres..."
            aria-label="Search for a game"
          />

          <div className="filter-row">
            <select
              className="input"
              name="platform"
              defaultValue={
                normalizedPlatform ?? ""
              }
              aria-label="Platform"
            >
              <LocaleText as="option" value="" ar="كل المنصات" en="All platforms" />

              {GAME_PLATFORMS.map((item) => (
                <option
                  key={item.slug}
                  value={item.slug}
                >
                  <LocaleText as="option" value={item.slug} ar={item.nameAr} en={item.nameEn} />
                </option>
              ))}
            </select>

            <select
              className="input"
              name="genre"
              defaultValue={genre}
              aria-label="Genre"
            >
              <LocaleText as="option" value="" ar="كل الأنواع" en="All genres" />

              {genreValues.map((value) => (
                <option key={value.slug} value={value.slug}>
                  {value.nameEn}
                </option>
              ))}
            </select>

            <select
              className="input"
              name="sort"
              defaultValue={sort}
              aria-label="Sort order"
            >
              <LocaleText as="option" value="rating" ar="الأعلى تقييمًا" en="Top rated" />

              <LocaleText as="option" value="popular" ar="الأكثر لعبًا" en="Most played" />

              <LocaleText as="option" value="views" ar="الأكثر مشاهدة" en="Most viewed" />

              <LocaleText as="option" value="newest" ar="الأحدث" en="Newest" />
            </select>

            <button
              className="btn"
              type="submit"
            >
              <LocaleText ar="بحث" en="Search" />
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

            <h2><LocaleText ar={game.titleAr} en={game.titleEn || game.titleAr} /></h2>

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
                      : <LocaleText ar="متعدد المنصات" en="Multi-platform" />}
                  </span>
                </span>
              )}
            </div>

            <p className="muted">
              {game.genre || "Gaming"} ·{" "}
              {game.playCount} <LocaleText ar="لعب" en="plays" />
            </p>
          </Link>
        ))}
      </div>

      {games.length > 0 && total > limit && (
        <nav className="glass card" aria-label="Pagination" style={{ marginTop: "18px", display: "flex", gap: "10px", justifyContent: "center", alignItems: "center", flexWrap: "wrap" }}>
          {page > 1 && (
            <Link className="btn" href={buildPageHref(page - 1)}>
              <LocaleText ar="السابق" en="Previous" />
            </Link>
          )}
          <span className="muted">{page} / {Math.ceil(total / limit)}</span>
          {page < Math.ceil(total / limit) && (
            <Link className="btn" href={buildPageHref(page + 1)}>
              <LocaleText ar="التالي" en="Next" />
            </Link>
          )}
        </nav>
      )}

      {!games.length && (
        <section className="glass card">
          <LocaleText as="h2" ar="لا توجد نتائج" en="No results" />

          <p className="muted">
            <LocaleText ar="جرّب تغيير البحث أو الفلاتر." en="Try changing your search or filters." />
          </p>
        </section>
      )}
    </main>
  );
}
