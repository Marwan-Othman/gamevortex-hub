
import { db } from "@/lib/prisma";
import { getOwnerOrAccessScreen } from "@/lib/admin-access";
import ContentManager from "./ContentManager";

export const dynamic = "force-dynamic";

export default async function AdminContentPage() {
  const gate = await getOwnerOrAccessScreen();
  if ("screen" in gate) return gate.screen;

  const [categories, games, apps] = await Promise.all([
    db.category.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { nameAr: "asc" }],
      take: 200,
      select: { id: true, nameAr: true, nameEn: true },
    }),
    db.game.findMany({
      orderBy: { updatedAt: "desc" },
      take: 30,
      select: {
        id: true, titleAr: true, titleEn: true, slug: true,
        platform: true, published: true, coverUrl: true,
        galleryUrls: true, downloadCount: true, updatedAt: true,
        gamePlatforms: { select: { platform: true } },
      },
    }),
    db.app.findMany({
      orderBy: { updatedAt: "desc" },
      take: 30,
      select: {
        id: true, nameAr: true, nameEn: true, slug: true,
        published: true, coverUrl: true, iconUrl: true,
        galleryUrls: true, downloadCount: true, updatedAt: true,
        appPlatforms: { select: { platform: true } },
      },
    }),
  ]);

  return (
    <main className="wrap" dir="rtl">
      <section className="glass hero">
        <h1>إدارة الألعاب والتطبيقات</h1>
        <p className="muted">
          صفحة واحدة للمالك فقط: APK من الهاتف أو رابط APK واحد، المنصة، التصنيف، MOD، والصور المتعددة.
        </p>
      </section>

      <ContentManager
        categories={categories}
        initialGames={games}
        initialApps={apps}
      />
    </main>
  );
}
