export const dynamic = "force-dynamic";

import { db } from "@/lib/prisma";
import { getOptionalUser } from "@/lib/auth";
import Link from "next/link";

export default async function WallpaperModerationPage() {
  const user = await getOptionalUser();
  if (user?.role !== "SUPER_ADMIN") return <main className="wrap"><section className="glass card"><h1>غير مصرح</h1><p className="muted">Admin access required.</p></section></main>;

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
      <Link className="btn" href="/admin/wallpapers">إدارة الخلفيات</Link>
    </section>
    <section className="grid" style={{ marginTop: 20 }}>
      {pending.map((item) => <article className="glass card" key={item.id}>
        {item.mediaType === "VIDEO" && item.mediaUrl ? <video controls preload="metadata" poster={item.imageUrl} style={{ width: "100%", borderRadius: 14 }} src={`/api/wallpapers/${item.id}/media`} /> : <img src={`/api/wallpapers/${item.id}/media`} alt={item.titleEn} loading="lazy" style={{ width: "100%", borderRadius: 14 }} />}
        <h2 style={{ marginTop: 12 }}>{item.titleAr}</h2>
        <p className="muted">{item.titleEn}</p>
        <p className="muted">Source: {item.sourceUrl || "—"}<br />License: {item.licenseUrl || "—"}<br />Attribution: {item.attribution || "—"}</p>
        <div className="tabs" style={{ marginTop: 12 }}>
          <form action="/api/admin/wallpapers/moderation" method="post"><input type="hidden" name="id" value={item.id} /></form>
          <button className="btn" data-moderate={item.id} data-decision="APPROVED">قبول ومكافأة المساهم بالنقاط</button>
          <button className="btn secondary" data-moderate={item.id} data-decision="REJECTED">رفض</button>
        </div>
      </article>)}
    </section>
    {!pending.length && <section className="glass card" style={{ marginTop: 20 }}><h2>لا توجد طلبات معلقة</h2><p className="muted">المراجعة فارغة حاليًا.</p></section>}
    <script dangerouslySetInnerHTML={{ __html: `document.addEventListener('click',async(e)=>{const b=e.target.closest('[data-moderate]');if(!b)return; b.disabled=true; const r=await fetch('/api/admin/wallpapers/moderation',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id:b.dataset.moderate,decision:b.dataset.decision})}); if(r.ok) location.reload(); else {b.disabled=false; alert('تعذر تنفيذ العملية');}})` }} />
  </main>;
}
