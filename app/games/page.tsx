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

type SortMode = "rating" | "popular" | "newest";

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

function FilterIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true">
      <path d="M4 6h16" />
      <path d="M7 12h10" />
      <path d="M10 18h4" />
    </svg>
  );
}

function GamepadIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="7" width="18" height="11" rx="4" />
      <path d="M7 11v4M5 13h4" />
      <path d="M16 12h.01M19 14h.01" />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="m12 2 2.9 6 6.6.9-4.8 4.6 1.1 6.5-6-3.1-6 3.1 1.1-6.5L2 8.9l6.6-.9z" />
    </svg>
  );
}

function FireIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22c4.2 0 7-2.8 7-6.7 0-4.5-3.3-6.8-5.2-9.8-.5 2.2-1.7 3.5-3 4.5-.3-2.4-1.4-4.7-3.4-6.3.1 3.6-2.4 5.4-2.4 9.4C5 18.9 7.8 22 12 22Z" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

export default async function Games({ searchParams }: Props) {
  const params = await searchParams;
  const q = (params.q || "").trim().slice(0, 80);
  const platform = (params.platform || "").trim().slice(0, 60);
  const genre = (params.genre || "").trim().slice(0, 60);

  const sort: SortMode =
    params.sort === "popular" || params.sort === "newest"
      ? params.sort
      : "rating";

  const normalizedPlatform = normalizePlatform(platform);
  const platformEnum = getPlatformEnum(normalizedPlatform);

  const where = {
    published: true,
    ...(platformEnum
      ? { gamePlatforms: { some: { platform: platformEnum } } }
      : {}),
    ...(genre
      ? { genre: { equals: genre, mode: "insensitive" as const } }
      : {}),
    ...(q
      ? {
          OR: [
            { titleAr: { contains: q, mode: "insensitive" as const } },
            { titleEn: { contains: q, mode: "insensitive" as const } },
            { description: { contains: q, mode: "insensitive" as const } },
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
      : sort === "newest"
        ? [{ createdAt: "desc" as const }]
        : [
            { featured: "desc" as const },
            { ratingAverage: "desc" as const },
            { ratingCount: "desc" as const },
          ];

  const [games, genres] = await Promise.all([
    db.game.findMany({
      where,
      orderBy,
      take: 60,
      include: { gamePlatforms: true },
    }),
    db.game.findMany({
      where: { published: true },
      select: { genre: true },
      distinct: ["genre"],
      orderBy: { genre: "asc" },
    }),
  ]);

  const genreValues = [
    ...new Set(
      genres
        .map((item) => item.genre)
        .filter((value): value is string => Boolean(value)),
    ),
  ];

  function buildHref(options?: {
    platform?: string;
    genre?: string;
    sort?: SortMode;
    q?: string;
  }) {
    const search = new URLSearchParams();
    const nextQ = options?.q !== undefined ? options.q : q;
    const nextPlatform =
      options?.platform !== undefined
        ? options.platform
        : normalizedPlatform || "";
    const nextGenre =
      options?.genre !== undefined ? options.genre : genre;
    const nextSort = options?.sort !== undefined ? options.sort : sort;

    if (nextQ) search.set("q", nextQ);
    if (nextPlatform) search.set("platform", nextPlatform);
    if (nextGenre) search.set("genre", nextGenre);
    if (nextSort !== "rating") search.set("sort", nextSort);

    const query = search.toString();
    return query ? `/games?${query}` : "/games";
  }

  const hasFilters =
    Boolean(q) ||
    Boolean(normalizedPlatform) ||
    Boolean(genre) ||
    sort !== "rating";

  return (
    <main className="wrap" dir="rtl">
      <section className="glass hero gv-games-hero">
        <div className="gv-games-hero-content">
          <div className="gv-games-eyebrow">
            <span className="gv-status-dot" />
            GAMEVORTEX DISCOVERY
          </div>

          <div className="gv-games-title-row">
            <div>
              <h1>اكتشف عالم الألعاب</h1>
              <p>
                اكتشف ألعابًا جديدة، تصفح حسب المنصة والتصنيف،
                واعثر على لعبتك القادمة من مكتبة GameVortex.
              </p>
            </div>

            <div className="gv-games-hero-icon" aria-hidden="true">
              <GamepadIcon />
            </div>
          </div>

          <div className="gv-games-stats">
            <span>
              <strong>{games.length}</strong>
              <small>نتيجة حالية</small>
            </span>
            <span>
              <strong>{genreValues.length}</strong>
              <small>تصنيف</small>
            </span>
            <span>
              <strong>{GAME_PLATFORMS.length}</strong>
              <small>منصة</small>
            </span>
          </div>
        </div>
      </section>

      <section className="glass card gv-games-search-panel" aria-label="البحث والفلترة">
        <form method="get" className="gv-games-search-form">
          <div className="gv-games-search-box">
            <span className="gv-games-search-icon"><SearchIcon /></span>
            <input
              className="input"
              name="q"
              defaultValue={q}
              maxLength={80}
              placeholder="ابحث باسم اللعبة أو الوصف..."
              aria-label="بحث عن لعبة"
            />
            {q && (
              <Link href={buildHref({ q: "" })} className="gv-games-clear" aria-label="مسح البحث">
                ×
              </Link>
            )}
          </div>

          <div className="gv-games-filter-row">
            <div className="gv-games-select">
              <label htmlFor="games-platform">المنصة</label>
              <select id="games-platform" className="input" name="platform" defaultValue={normalizedPlatform || ""}>
                <option value="">كل المنصات</option>
                {GAME_PLATFORMS.map((item) => (
                  <option key={item.slug} value={item.slug}>{item.nameAr}</option>
                ))}
              </select>
            </div>

            <div className="gv-games-select">
              <label htmlFor="games-genre">التصنيف</label>
              <select id="games-genre" className="input" name="genre" defaultValue={genre}>
                <option value="">كل التصنيفات</option>
                {genreValues.map((value) => (
                  <option key={value} value={value}>{value}</option>
                ))}
              </select>
            </div>

            <div className="gv-games-select">
              <label htmlFor="games-sort">الترتيب</label>
              <select id="games-sort" className="input" name="sort" defaultValue={sort}>
                <option value="rating">الأعلى تقييمًا</option>
                <option value="popular">الأكثر لعبًا</option>
                <option value="newest">الأحدث</option>
              </select>
            </div>

            <button className="btn gv-games-search-button" type="submit">
              <SearchIcon />
              <span>بحث</span>
            </button>
          </div>
        </form>
      </section>

      <section className="gv-games-filter-section" aria-labelledby="platform-filter-title">
        <div className="gv-games-section-head">
          <div>
            <span className="gv-games-section-kicker">PLATFORMS</span>
            <h2 id="platform-filter-title">تصفح حسب المنصة</h2>
          </div>
          <GridIcon />
        </div>

        <div className="gv-games-filter-scroll">
          <Link
            href={buildHref({ platform: "" })}
            className={`gv-games-platform-chip ${!normalizedPlatform ? "is-active" : ""}`}
          >
            <span className="gv-games-platform-icon">🎮</span>
            <span>كل المنصات</span>
          </Link>

          {GAME_PLATFORMS.map((item) => (
            <Link
              key={item.slug}
              href={buildHref({ platform: item.slug })}
              className={`gv-games-platform-chip ${
                normalizedPlatform === item.slug ? "is-active" : ""
              }`}
            >
              <span className="gv-games-platform-icon">{item.icon}</span>
              <span>{getPlatformName(item.slug, "ar")}</span>
            </Link>
          ))}
        </div>
      </section>

      {genreValues.length > 0 && (
        <section className="gv-games-filter-section gv-games-genre-section" aria-labelledby="genre-filter-title">
          <div className="gv-games-section-head">
            <div>
              <span className="gv-games-section-kicker">CATEGORIES</span>
              <h2 id="genre-filter-title">استكشف التصنيفات</h2>
            </div>
            <FilterIcon />
          </div>

          <div className="gv-games-filter-scroll">
            <Link
              href={buildHref({ genre: "" })}
              className={`gv-games-genre-chip ${!genre ? "is-active" : ""}`}
            >
              الكل
            </Link>

            {genreValues.map((value) => (
              <Link
                key={value}
                href={buildHref({ genre: value })}
                className={`gv-games-genre-chip ${genre === value ? "is-active" : ""}`}
              >
                {value}
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="gv-games-results-head">
        <div>
          <span className="gv-games-section-kicker">GAME LIBRARY</span>
          <h2>
            {q
              ? `نتائج البحث عن "${q}"`
              : sort === "popular"
                ? "الأكثر لعبًا"
                : sort === "newest"
                  ? "أحدث الألعاب"
                  : "الأعلى تقييمًا"}
          </h2>
        </div>

        <div className="gv-games-results-meta">
          <span>{games.length} لعبة</span>
          {hasFilters && (
            <Link href="/games" className="gv-games-reset">
              إعادة ضبط الفلاتر
            </Link>
          )}
        </div>
      </section>

      <div className="gv-games-source-note">
        <span className="gv-games-source-dot" />
        <span>
          بيانات الألعاب المعروضة من مكتبة GameVortex. بعض البيانات
          المستوردة من RAWG تخضع لشروط المصدر، مع روابط المتاجر الرسمية عند توفرها.
        </span>
        <a href="https://rawg.io" target="_blank" rel="noreferrer">RAWG</a>
      </div>

      <section className="gv-games-grid" aria-label="الألعاب">
        {games.map((game) => {
          const score = vortexScore(game);

          return (
            <Link href={`/games/${game.slug}`} key={game.id} className="gv-games-card">
              <div className="gv-games-cover">
                {game.coverUrl ? (
                  <img src={game.coverUrl} alt={game.titleEn} loading="lazy" />
                ) : (
                  <div className="gv-games-cover-fallback">
                    <span>GAMEVORTEX</span>
                  </div>
                )}

                <div className="gv-games-cover-overlay" />
                <span className="gv-games-score">V {score}</span>

                {game.featured && (
                  <span className="gv-games-featured">✦ مميز</span>
                )}

                <span className="gv-games-cover-arrow">↗</span>
              </div>

              <div className="gv-games-card-body">
                <div className="gv-games-card-meta">
                  <span className="gv-games-rating">
                    <StarIcon />
                    {game.ratingAverage.toFixed(1)}
                  </span>

                  <span className="gv-games-plays">
                    <FireIcon />
                    {game.playCount.toLocaleString("ar")}
                  </span>
                </div>

                <h3>{game.titleAr}</h3>
                <p className="gv-games-title-en">{game.titleEn}</p>

                <div className="gv-games-card-bottom">
                  <div className="gv-games-platforms">
                    {game.gamePlatforms.length > 0 ? (
                      game.gamePlatforms.slice(0, 3).map((item) => {
                        const slug = getPlatformSlugFromEnum(item.platform);
                        const info = GAME_PLATFORMS.find(
                          (platformItem) => platformItem.slug === slug,
                        );

                        return (
                          <span
                            className="gv-games-mini-platform"
                            key={item.platform}
                            title={info?.nameAr || item.platform}
                          >
                            {info?.icon || "🎮"}
                          </span>
                        );
                      })
                    ) : (
                      <span className="gv-games-multi-platform">🎮</span>
                    )}
                  </div>

                  <span className="gv-games-genre">{game.genre || "Gaming"}</span>
                </div>
              </div>
            </Link>
          );
        })}
      </section>

      {!games.length && (
        <section className="gv-games-empty">
          <div className="gv-games-empty-icon"><SearchIcon /></div>
          <span className="gv-games-section-kicker">NO RESULTS</span>
          <h2>لا توجد ألعاب مطابقة</h2>
          <p>
            لم نجد ألعابًا تطابق البحث أو الفلاتر الحالية. جرّب تغيير الكلمات
            أو اختيار منصة أو تصنيف آخر.
          </p>
          <Link href="/games" className="btn gv-games-empty-button">
            عرض جميع الألعاب
          </Link>
        </section>
      )}
    </main>
  );
}
