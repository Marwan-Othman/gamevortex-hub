export const dynamic = "force-dynamic";

import Link from "next/link";
import { db } from "../../lib/prisma";
import styles from "../home.module.css";
import { GAME_PLATFORMS } from "../../lib/platforms";

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

            <h1>استكشف الألعاب</h1>

            <p className="muted">
              اختر المنصة أو نوع اللعبة للوصول إلى
              الألعاب التي تبحث عنها بسهولة.
            </p>
          </div>
        </div>

        <h2>المنصات</h2>

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
                    {platform.nameAr}
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
            <h2>التصنيفات</h2>

            <p className="muted">
              تصفح الألعاب حسب النوع.
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
                  {genre._count._all} لعبة
                </p>
              </Link>
            );
          })}

          {!genres.length && (
            <p className="muted">
              لا توجد تصنيفات متاحة حاليًا.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
