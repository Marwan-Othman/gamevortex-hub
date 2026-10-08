import Link from "next/link";
import { db } from "../../../lib/prisma";
import { getOwnerOrAccessScreen } from "../../../lib/admin-access";
import { getPlatformSlugFromEnum } from "../../../lib/platforms";
import GameUploadForm from "./GameUploadForm";

export const dynamic = "force-dynamic";

export default async function AdminGames() {
  const gate = await getOwnerOrAccessScreen();
  if ("screen" in gate) return gate.screen;

  const [games, categories] = await Promise.all([
    db.game.findMany({
      orderBy: { updatedAt: "desc" },
      take: 100,
      select: {
        id: true, slug: true, titleAr: true, titleEn: true, published: true, featured: true,
        sourceStatus: true, downloadSource: true, downloadCount: true, updatedAt: true,
        gamePlatforms: { select: { platform: true } },
      },
    }),
    db.category.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { nameAr: "asc" }],
      select: { id: true, nameAr: true, nameEn: true },
      take: 200,
    }),
  ]);

  return (
    <main className="wrap" dir="rtl">
      <section className="glass hero">
        <Link href="/admin">← لوحة الإدارة</Link>
        <h1>إدارة الألعاب</h1>
        <p>إضافة الألعاب من الهاتف مباشرة، تخزين ملفاتها، نشرها، وإتاحة تحميلها من صفحة اللعبة.</p>
      </section>

      <GameUploadForm categories={categories} />

      <section className="glass card" style={{ marginBottom: 16 }}>
        <h2>الألعاب الحالية</h2>
        <p className="muted">آخر 100 لعبة محدثة. الحذف الحالي غير مدمر؛ النشر يمكن التحكم به من حالة اللعبة.</p>
      </section>

      <section className="grid">
        {games.map((game) => {
          const platforms = game.gamePlatforms.map((item) => getPlatformSlugFromEnum(item.platform)).filter(Boolean);
          return (
            <article className="glass card" key={game.id}>
              <span className="badge">{game.sourceStatus}</span>
              <h2>{game.titleAr}</h2>
              <p className="muted">{game.titleEn} · {game.slug}</p>
              {platforms.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                  {platforms.map((platform) => <span className="badge" key={platform}>{platform}</span>)}
                </div>
              )}
              <p>{game.published ? "منشورة" : "غير منشورة"}{game.featured ? " · مميزة" : ""}{game.downloadSource ? " · ملف متوفر" : " · بدون ملف"}</p>
              <p className="muted">التحميلات: {game.downloadCount}</p>
              <p className="muted">آخر تحديث: {game.updatedAt.toLocaleDateString("ar")}</p>
            </article>
          );
        })}
        {!games.length && <p>لا توجد ألعاب بعد.</p>}
      </section>
    </main>
  );
}
