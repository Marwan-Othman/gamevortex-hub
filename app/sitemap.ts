export const dynamic = "force-dynamic";
import { MetadataRoute } from "next";
import { db } from "@/lib/prisma";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (process.env.APP_ORIGIN || "http://localhost:3000").replace(/\/$/, "");
  const [games, apps] = await Promise.all([
    db.game.findMany({ where: { published: true }, select: { slug: true, updatedAt: true } }),
    db.app.findMany({ where: { published: true }, select: { slug: true, updatedAt: true } }),
  ]);
  return [
    { url: base, lastModified: new Date(), changeFrequency: "daily", priority: 1 },
    { url: `${base}/games`, lastModified: new Date(), changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/apps`, lastModified: new Date(), changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/categories`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.7 },
    { url: `${base}/vip`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.7 },
    { url: `${base}/marketplace`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.7 },
    { url: `${base}/gift-cards`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.6 },
    { url: `${base}/rankings`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.5 },
    { url: `${base}/quran`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.7 },
    { url: `${base}/legal/terms`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/legal/privacy`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.3 },
    ...games.map(g => ({ url: `${base}/games/${g.slug}`, lastModified: g.updatedAt, changeFrequency: "weekly" as const, priority: 0.8 })),
    ...apps.map(a => ({ url: `${base}/apps/${a.slug}`, lastModified: a.updatedAt, changeFrequency: "weekly" as const, priority: 0.8 })),
  ];
}
