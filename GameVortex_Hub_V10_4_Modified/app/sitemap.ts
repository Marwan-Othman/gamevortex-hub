export const dynamic = "force-dynamic";
import { MetadataRoute } from "next";
import { db } from "@/lib/prisma";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (process.env.APP_ORIGIN || "http://localhost:3000").replace(/\/$/, "");
  const games = await db.game.findMany({ where: { published: true }, select: { slug: true, updatedAt: true } });
  return [
    { url: base, lastModified: new Date(), changeFrequency: "daily", priority: 1 },
    { url: `${base}/games`, lastModified: new Date(), changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/quran`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.7 },
    ...games.map(g => ({ url: `${base}/games/${g.slug}`, lastModified: g.updatedAt, changeFrequency: "weekly" as const, priority: 0.8 })),
  ];
}
