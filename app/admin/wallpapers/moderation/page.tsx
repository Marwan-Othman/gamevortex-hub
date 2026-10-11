export const dynamic = "force-dynamic";

import { db } from "@/lib/prisma";
import { getOwnerOrAccessScreen } from "@/lib/admin-access";
import WallpaperModerationActions from "@/components/admin/WallpaperModerationActions";
import Link from "next/link";

export default async function WallpaperModerationPage() {
  const gate = await getOwnerOrAccessScreen();
  if ("screen" in gate) return gate.screen;

  const pending = await db.wallpaper.findMany({
    where: { moderationStatus: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: 200,
    select: { id: true, titleAr: true, titleEn: true, imageUrl: true, mediaUrl: true, mediaType: true, sourceUrl: true, licenseUrl: true, attribution: true, createdAt: true },
  });

  return <main className="wrap">
    <section className="glass hero">
      <p className="muted">GAMEVORTEX WALLPAPERS</p>
      <h1>مراجعة الخلفيات</h1>
      <p className="muted">المحتوى المرفوع من المستخدمين لا يظهر للعامة قبل الموافقة.</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><Link className="btn" href="/admin/wallpapers">إدارة الخلفيات</Link><Link className="btn secondary" href="/admin/moderation">بلاغات المحتوى</Link></div>
    </section>
    <section className="grid" style={{ marginTop: 20 }}>
      {pending.map((item) => <article className="glass card" key={item.id}>
        {item.mediaType === "VIDEO" && item.mediaUrl ? <video controls preload="metadata" poster={item.imageUrl} style={{ width: "100%", borderRadius: 14 }} src={`/api/wallpapers/${item.id}/media`} /> : <img src={`/api/wallpapers/${item.id}/media`} alt={item.titleEn} loading="lazy" style={{ width: "100%", borderRadius: 14 }} />}
        <h2 style={{ marginTop: 12 }}>{item.titleAr}</h2>
        <p className="muted">{item.titleEn}</p>
        <p className="muted">Source: {item.sourceUrl || "—"}<br />License: {item.licenseUrl || "—"}<br />Attribution: {item.attribution || "—"}</p>
        <WallpaperModerationActions id={item.id} />
      </article>)}
    </section>
    {!pending.length && <section className="glass card" style={{ marginTop: 20 }}><h2>لا توجد طلبات معلقة</h2><p className="muted">المراجعة فارغة حاليًا.</p></section>}
  </main>;
}
