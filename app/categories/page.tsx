export const dynamic = "force-dynamic";

import Link from "next/link";
import { db } from "../../lib/prisma";
import styles from "../home.module.css";
import { GAME_PLATFORMS } from "../../lib/platforms";
import LocaleText from "@/components/ui/LocaleText";

export const metadata = {
  title: "التصنيفات | GameVortex Hub",
  description:
    "تصفح تصنيفات ومنصات الألعاب المتاحة على GameVortex Hub.",
};

export default async function CategoriesPage() {
  const genres = await db.game.groupBy({
    by: ["genre"],
    where: {
      published: true,
      genre: {
        not: null,
      },
    },
    _count: {
      _all: true,
    },
    orderBy: {
      _count: {
        genre: "desc",
      },
    },
  });

  return (
    <main className={styles.page}>
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <p className="muted">
              GAMEVORTEX DISCOVERY
            </p>

            <LocaleText as="h1" ar="استكشف الألعاب" en="Explore games" />

            <p className="muted">
              <LocaleText as="span" ar="اختر المنصة أو نوع اللعبة للوصول إلى الألعاب التي تبحث عنها بسهولة." en="Choose a platform or genre to quickly find the games you are looking for." />
            </p>
          </div>
        </div>

        <LocaleText as="h2" ar="المنصات" en="Platforms" />

        <div className="grid">
          {GAME_PLATFORMS.map((platform) => (
            <Link
              key={platform.slug}
              href={`/games?platform=${encodeURIComponent(
                platform.slug,
              )}`}
              className="card game-card"
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                }}
              >
                <span
                  style={{
                    fontSize: "2rem",
                  }}
                  aria-hidden="true"
                >
                  {platform.icon}
                </span>

                <div>
                  <h3
                    style={{
                      margin: 0,
                    }}
                  >
                    <LocaleText ar={platform.nameAr} en={platform.nameEn} />
                  </h3>

                  <p
                    className="muted"
                    style={{
                      margin: "6px 0 0",
                    }}
                  >
                    {platform.nameEn}
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <LocaleText as="h2" ar="التصنيفات" en="Genres" />

            <p className="muted">
              <LocaleText ar="تصفح الألعاب حسب النوع." en="Browse games by genre." />
            </p>
          </div>
        </div>

        <div className="grid">
          {genres.map((genre) => {
            const value = genre.genre;

            if (!value) {
              return null;
            }

            return (
              <Link
                key={value}
                href={`/games?genre=${encodeURIComponent(
                  value,
                )}`}
                className="card game-card"
              >
                <h3
                  style={{
                    margin: 0,
                  }}
                >
                  {value}
                </h3>

                <p
                  className="muted"
                  style={{
                    margin: "6px 0 0",
                  }}
                >
                  {genre._count._all} <LocaleText ar="لعبة" en="games" />
                </p>
              </Link>
            );
          })}

          {!genres.length && (
            <p className="muted">
              <LocaleText ar="لا توجد تصنيفات متاحة حاليًا." en="No genres are available right now." />
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
