import { db } from "@/lib/prisma";
import { getOwnerOrAccessScreen } from "@/lib/admin-access";
import ContentManager from "./ContentManager";

export const dynamic = "force-dynamic";

export default async function AdminContentPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const gate = await getOwnerOrAccessScreen();
  if ("screen" in gate) return gate.screen;

  const id = (await searchParams).id?.trim() || "";
  const [games, apps, editingGame, editingApp] = await Promise.all([
    db.game.findMany({
      orderBy: { updatedAt: "desc" },
      take: 100,
      select: { id: true, titleAr: true, titleEn: true, slug: true, versionType: true, published: true, coverUrl: true, updatedAt: true },
    }),
    db.app.findMany({
      orderBy: { updatedAt: "desc" },
      take: 100,
      select: { id: true, nameAr: true, nameEn: true, slug: true, versionType: true, published: true, coverUrl: true, updatedAt: true },
    }),
    id ? db.game.findUnique({ where: { id }, include: { gamePlatforms: true } }) : null,
    id ? db.app.findUnique({ where: { id }, include: { appPlatforms: true } }) : null,
  ]);

  const editing = editingGame
    ? {
        id: editingGame.id, contentType: "GAME" as const, name: editingGame.titleAr,
        description: editingGame.description, platform: editingGame.gamePlatforms[0]?.platform ?? "ANDROID",
        versionType: editingGame.versionType, mainImageUrl: editingGame.coverUrl,
        screenshotUrls: Array.isArray(editingGame.screenshots) ? editingGame.screenshots.filter((x): x is string => typeof x === "string") : [],
        downloadSource: editingGame.downloadSource, slug: editingGame.slug,
      }
    : editingApp
      ? {
          id: editingApp.id, contentType: "APP" as const, name: editingApp.nameAr,
          description: editingApp.descriptionAr, platform: editingApp.appPlatforms[0]?.platform ?? "ANDROID",
          versionType: editingApp.versionType, mainImageUrl: editingApp.coverUrl,
          screenshotUrls: Array.isArray(editingApp.screenshots) ? editingApp.screenshots.filter((x): x is string => typeof x === "string") : [],
          downloadSource: editingApp.downloadSource, slug: editingApp.slug,
        }
      : null;

  const items = [
    ...games.map((x) => ({ id:x.id, contentType:"GAME" as const, name:x.titleAr, secondaryName:x.titleEn, slug:x.slug, versionType:x.versionType, published:x.published, imageUrl:x.coverUrl, updatedAt:x.updatedAt })),
    ...apps.map((x) => ({ id:x.id, contentType:"APP" as const, name:x.nameAr, secondaryName:x.nameEn, slug:x.slug, versionType:x.versionType, published:x.published, imageUrl:x.coverUrl, updatedAt:x.updatedAt })),
  ].sort((a,b)=>b.updatedAt.getTime()-a.updatedAt.getTime());

  return <ContentManager items={items} editing={editing} />;
}
