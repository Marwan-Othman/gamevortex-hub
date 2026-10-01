import Link from "next/link";
import { db } from "@/lib/prisma";
import { getOwnerOrAccessScreen } from "@/lib/admin-access";
import WallpaperAdminClient from "./WallpaperAdminClient";

export const dynamic = "force-dynamic";

export default async function AdminWallpapers() {
  const gate = await getOwnerOrAccessScreen();
  if ("screen" in gate) return gate.screen;

  const wallpapers = await db.wallpaper.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    take: 500,
    select: {
      id: true,
      titleAr: true,
      titleEn: true,
      thumbnailUrl: true,
      type: true,
      category: true,
      tags: true,
      isVip: true,
      published: true,
      featured: true,
      isAnimated: true,
      mimeType: true,
      originalFilename: true,
      width: true,
      height: true,
      viewCount: true,
      downloadCount: true,
      sourceStatus: true,
    },
  });

  return (
    <main className="wrap" dir="rtl">
      <section className="glass hero">
        <Link href="/admin">← لوحة الإدارة</Link>
        <h1>إدارة الخلفيات</h1>
        <p className="muted">
          ارفع الصور من الهاتف أو أضفها بالرابط، مع دعم الصور المتحركة والحفاظ على الملف الأصلي.
        </p>
        <Link href="/wallpapers">عرض صفحة الخلفيات للزوار ←</Link>
      </section>
      <WallpaperAdminClient initialWallpapers={wallpapers} />
    </main>
  );
}
