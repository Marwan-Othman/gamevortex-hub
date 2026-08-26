import Link from "next/link";
import { db } from "../../../lib/prisma";
import { requireOwner } from "../../../lib/auth";

export default async function AdminGames() {
  await requireOwner();
  const games = await db.game.findMany({
    orderBy: { updatedAt: "desc" }, take: 100,
    select: { id:true, slug:true, titleAr:true, titleEn:true, published:true, featured:true, sourceStatus:true, updatedAt:true }
  });
  return <main className="wrap" dir="rtl">
    <section className="glass hero"><Link href="/admin">← لوحة الإدارة</Link><h1>إدارة الألعاب</h1><p>V10 يمنع نشر لعبة بمصدر غير موثوق، ويحافظ على السجل بدل الحذف المدمر.</p></section>
    <section className="grid">{games.map(g => <article className="glass card" key={g.id}>
      <span className="badge">{g.sourceStatus}</span><h2>{g.titleAr}</h2><p className="muted">{g.titleEn} · {g.slug}</p>
      <p>{g.published ? "منشورة" : "غير منشورة"} {g.featured ? "· مميزة" : ""}</p>
    </article>)}{!games.length && <p>لا توجد ألعاب بعد.</p>}</section>
  </main>;
}
