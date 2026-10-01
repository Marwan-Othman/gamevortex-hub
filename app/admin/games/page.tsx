import Link from "next/link";
import { db } from "../../../lib/prisma";
import { getOwnerOrAccessScreen } from "../../../lib/admin-access";
import { getPlatformSlugFromEnum } from "../../../lib/platforms";

export const dynamic = "force-dynamic";

export default async function AdminGames() {
  const gate = await getOwnerOrAccessScreen();

  if ("screen" in gate) {
    return gate.screen;
  }

  const games = await db.game.findMany({
    orderBy: {
      updatedAt: "desc",
    },
    take: 100,
    select: {
      id: true,
      slug: true,
      titleAr: true,
      titleEn: true,
      published: true,
      featured: true,
      sourceStatus: true,
      updatedAt: true,
      gamePlatforms: {
        select: {
          platform: true,
        },
      },
    },
  });

  return (
    <main className="wrap" dir="rtl">
      <section className="glass hero">
        <Link href="/admin">← لوحة الإدارة</Link>

        <h1>إدارة الألعاب</h1>

        <p>
          إدارة ألعاب GameVortex حسب المنصة مع الحفاظ على
          التحقق من مصادر الألعاب وعدم الحذف المدمر.
        </p>
      </section>

      <section className="grid">
        {games.map((game) => {
          const platforms = game.gamePlatforms
            .map((item) =>
              getPlatformSlugFromEnum(item.platform),
            )
            .filter(Boolean);

          return (
            <article
              className="glass card"
              key={game.id}
            >
              <span className="badge">
                {game.sourceStatus}
              </span>

              <h2>{game.titleAr}</h2>

              <p className="muted">
                {game.titleEn} · {game.slug}
              </p>

              {platforms.length > 0 && (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "8px",
                    marginTop: "12px",
                  }}
                >
                  {platforms.map((platform) => (
                    <span
                      className="badge"
                      key={platform}
                    >
                      {platform}
                    </span>
                  ))}
                </div>
              )}

              <p>
                {game.published
                  ? "منشورة"
                  : "غير منشورة"}

                {game.featured
                  ? " · مميزة"
                  : ""}
              </p>

              <p className="muted">
                آخر تحديث:{" "}
                {game.updatedAt.toLocaleDateString(
                  "ar",
                )}
              </p>
            </article>
          );
        })}

        {!games.length && (
          <p>لا توجد ألعاب بعد.</p>
        )}
      </section>
    </main>
  );
}
