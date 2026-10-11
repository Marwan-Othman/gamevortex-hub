import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getOwnerOrAccessScreen } from "@/lib/admin-access";
import ContentManager, { type ContentListItem } from "./ContentManager";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 30;

type Props = { searchParams: Promise<{ q?: string; page?: string }> };

/**
 * The single owner page for adding AND editing games and apps.
 * Access is checked here (page) and again in every /api/admin/content route (server-side).
 * The list is searchable and paged so every imported game can be reached (the catalog has hundreds).
 */
export default async function AdminContentPage({ searchParams }: Props) {
  const gate = await getOwnerOrAccessScreen();
  if ("screen" in gate) return gate.screen;

  const params = await searchParams;
  const q = (params.q ?? "").trim().slice(0, 80);
  const pageValue = Number(params.page ?? "1");
  const page = Number.isFinite(pageValue) && pageValue > 0 ? Math.min(Math.floor(pageValue), 10_000) : 1;

  const gameWhere = q
    ? {
        OR: [
          { titleAr: { contains: q, mode: "insensitive" as const } },
          { titleEn: { contains: q, mode: "insensitive" as const } },
          { slug: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};
  const appWhere = q
    ? {
        OR: [
          { nameAr: { contains: q, mode: "insensitive" as const } },
          { nameEn: { contains: q, mode: "insensitive" as const } },
          { slug: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};

  const [games, apps, gameTotal, appTotal, categories] = await Promise.all([
    prisma.game.findMany({
      where: gameWhere,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true, titleAr: true, slug: true, isMod: true, version: true, published: true, coverUrl: true, updatedAt: true,
        gamePlatforms: { select: { platform: true }, take: 1 },
      },
    }),
    prisma.app.findMany({
      where: appWhere,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true, nameAr: true, slug: true, isMod: true, version: true, published: true, coverUrl: true, iconUrl: true, updatedAt: true,
        appPlatforms: { select: { platform: true }, take: 1 },
      },
    }),
    prisma.game.count({ where: gameWhere }),
    prisma.app.count({ where: appWhere }),
    prisma.category.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { nameEn: "asc" }],
      select: { id: true, nameAr: true, nameEn: true },
    }),
  ]);

  const items: ContentListItem[] = [
    ...games.map((game) => ({
      id: game.id,
      type: "game" as const,
      name: game.titleAr,
      slug: game.slug,
      isMod: game.isMod,
      version: game.version,
      published: game.published,
      image: game.coverUrl,
      platform: game.gamePlatforms[0]?.platform ?? null,
      updatedAt: game.updatedAt.getTime(),
    })),
    ...apps.map((app) => ({
      id: app.id,
      type: "app" as const,
      name: app.nameAr,
      slug: app.slug,
      isMod: app.isMod,
      version: app.version,
      published: app.published,
      image: app.coverUrl ?? app.iconUrl,
      platform: app.appPlatforms[0]?.platform ?? null,
      updatedAt: app.updatedAt.getTime(),
    })),
  ].sort((a, b) => b.updatedAt - a.updatedAt);

  const totalPages = Math.max(1, Math.ceil(Math.max(gameTotal, appTotal) / PAGE_SIZE));
  const href = (nextPage: number) => {
    const search = new URLSearchParams();
    if (q) search.set("q", q);
    if (nextPage > 1) search.set("page", String(nextPage));
    const query = search.toString();
    return query ? `/admin/content?${query}` : "/admin/content";
  };

  return (
    <main className="wrap" dir="rtl">
      <section className="glass hero">
        <Link href="/admin">← لوحة الإدارة</Link>
        <h1>إضافة وتعديل الألعاب والتطبيقات</h1>
        <p className="muted">
          {gameTotal} لعبة · {appTotal} تطبيق{q ? ` (نتائج البحث عن "${q}")` : ""}
        </p>
        <form method="get" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input className="input" name="q" defaultValue={q} maxLength={80} placeholder="ابحث بالاسم أو الرابط المختصر" aria-label="بحث في المحتوى" />
          <button className="btn" type="submit">بحث</button>
          {q && <Link className="btn secondary" href="/admin/content">مسح البحث</Link>}
        </form>
      </section>

      <ContentManager items={items} categories={categories} />

      {totalPages > 1 && (
        <nav className="glass card" aria-label="Pagination" style={{ marginTop: 18, display: "flex", gap: 10, justifyContent: "center", alignItems: "center", flexWrap: "wrap" }}>
          {page > 1 && <Link className="btn secondary" href={href(page - 1)}>السابق</Link>}
          <span className="muted">{Math.min(page, totalPages)} / {totalPages}</span>
          {page < totalPages && <Link className="btn secondary" href={href(page + 1)}>التالي</Link>}
        </nav>
      )}
    </main>
  );
}
