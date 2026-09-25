export const dynamic = "force-dynamic";
import Link from "next/link";
import { db } from "../../lib/prisma";
import styles from "../home.module.css";

export const metadata = {
  title: "التصنيفات | GameVortex Hub",
  description: "تصفح كل تصنيفات الألعاب المتاحة على GameVortex Hub.",
};

export default async function CategoriesPage() {
  const genres = await db.game.groupBy({
    by: ["genre"],
    where: { published: true, genre: { not: null } },
    _count: { _all: true },
    orderBy: { _count: { genre: "desc" } },
  });

  return (
    <main className={styles.page}>
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2>كل التصنيفات</h2>
        </div>
        <div className="grid">
          {genres.map((g) => (
            <Link key={g.genre} href={`/games?genre=${encodeURIComponent(g.genre || "")}`} className="card game-card">
              <h3 style={{ margin: 0 }}>{g.genre}</h3>
              <p className="muted" style={{ margin: "6px 0 0" }}>{g._count._all} لعبة</p>
            </Link>
          ))}
          {!genres.length && <p className="muted">لا توجد تصنيفات متاحة حاليًا.</p>}
        </div>
      </section>
    </main>
  );
}
