import Link from "next/link";
import { db } from "@/lib/prisma";
import { getOwnerOrAccessScreen } from "@/lib/admin-access";
import DownloaderClient from "./DownloaderClient";

export const dynamic = "force-dynamic";

export default async function AdminDownloader() {
  const gate = await getOwnerOrAccessScreen();
  if ("screen" in gate) return gate.screen;

  const [games, apps] = await Promise.all([
    db.game.findMany({
      orderBy: { titleEn: "asc" },
      take: 500,
      select: { id: true, titleAr: true, titleEn: true },
    }),
    db.app.findMany({
      orderBy: { nameEn: "asc" },
      take: 500,
      select: { id: true, nameAr: true, nameEn: true },
    }),
  ]);

  return (
    <main className="wrap" dir="rtl">
      <section className="glass hero">
        <Link href="/admin">← لوحة الإدارة</Link>
        <h1>GameVortex Downloader</h1>
        <p className="muted">
          استيراد ملف مصرح بتوزيعه إلى تخزين GameVortex وربطه باللعبة أو التطبيق.
        </p>
      </section>

      <DownloaderClient
        games={games.map((game) => ({ id: game.id, label: `${game.titleAr} · ${game.titleEn}` }))}
        apps={apps.map((app) => ({ id: app.id, label: `${app.nameAr} · ${app.nameEn}` }))}
      />

      <section className="glass card">
        <h2>قواعد الأداة</h2>
        <ul>
          <li>الأداة للمالك فقط.</li>
          <li>لا تسمح باستيراد مصدر غير مصنف كمصدر رسمي/مرخص/مفتوح/قابل لإعادة التوزيع.</li>
          <li>الملف يُخزن في Vercel Blob، والواجهة العامة تستخدم رابط تنزيل GameVortex.</li>
          <li>كل عملية استيراد تُسجل في AuditLog.</li>
          <li>الحد الحالي للاستيراد الواحد 512MB؛ الملفات الأكبر تحتاج بنية multipart/worker منفصلة.</li>
        </ul>
      </section>
    </main>
  );
}
