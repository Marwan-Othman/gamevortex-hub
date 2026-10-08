import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getOwnerOrAccessScreen } from "@/lib/admin-access";
import ContentManager, { type ContentListItem } from "./ContentManager";

export const dynamic = "force-dynamic";

/**
 * The single owner page for adding AND editing games and apps.
 * Access is checked here (page) and again in every /api/admin/content route (server-side).
 */
export default async function AdminContentPage() {
  const gate = await getOwnerOrAccessScreen();
  if ("screen" in gate) return gate.screen;

  const [games, apps] = await Promise.all([
    prisma.game.findMany({
      orderBy: { updatedAt: "desc" },
      take: 100,
      select: {
        id: true, titleAr: true, slug: true, isMod: true, published: true, coverUrl: true, updatedAt: true,
        gamePlatforms: { select: { platform: true }, take: 1 },
      },
    }),
    prisma.app.findMany({
      orderBy: { updatedAt: "desc" },
      take: 100,
      select: {
        id: true, nameAr: true, slug: true, isMod: true, published: true, coverUrl: true, iconUrl: true, updatedAt: true,
        appPlatforms: { select: { platform: true }, take: 1 },
      },
    }),
  ]);

  const items: ContentListItem[] = [
    ...games.map((game) => ({
      id: game.id,
      type: "game" as const,
      name: game.titleAr,
      slug: game.slug,
      isMod: game.isMod,
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
      published: app.published,
      image: app.coverUrl ?? app.iconUrl,
      platform: app.appPlatforms[0]?.platform ?? null,
      updatedAt: app.updatedAt.getTime(),
    })),
  ].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <main className="wrap" dir="rtl">
      <section className="glass hero">
        <Link href="/admin">← لوحة الإدارة</Link>
        <h1>إضافة وتعديل الألعاب والتطبيقات</h1>
      </section>
      <ContentManager items={items} />
    </main>
  );
}
