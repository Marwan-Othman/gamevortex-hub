import Link from "next/link";
import { db } from "@/lib/prisma";
import { getOwnerOrAccessScreen } from "@/lib/admin-access";
import WallpaperAdminClient from "./WallpaperAdminClient";

export const dynamic = "force-dynamic";

export default async function AdminWallpapers() {
  const gate = await getOwnerOrAccessScreen();
  if ("screen" in gate) return gate.screen;
  const wallpapers = await db.wallpaper.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }], take: 200 });

  return <main className="wrap" dir="rtl">
    <section className="glass hero">
      <Link href="/admin">← لوحة الإدارة</Link>
      <h1>إدارة الخلفيات</h1>
      <p className="muted">أضف خلفيات الهاتف والكمبيوتر، انشرها أو أخفها، وعيّن الخلفيات المميزة من مكان واحد.</p>
      <Link href="/wallpapers">عرض صفحة الخلفيات للزوار ←</Link>
    </section>
    <WallpaperAdminClient initialWallpapers={wallpapers} />
  </main>;
}
