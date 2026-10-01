import Link from "next/link";
import { db } from "@/lib/prisma";
import { getPlatformSlugFromEnum } from "@/lib/platforms";

export const dynamic = "force-dynamic";

export default async function ModsPage() {
  const mods = await db.mod.findMany({
    where: { published: true },
    orderBy: [{ featured: "desc" }, { sortOrder: "asc" }, { createdAt: "desc" }],
    take: 60,
    select: {
      id: true,
      slug: true,
      titleAr: true,
      titleEn: true,
      descriptionAr: true,
      descriptionEn: true,
      imageUrl: true,
      downloadUrl: true,
      modUrl: true,
      platform: true,
      game: { select: { titleAr: true, titleEn: true } },
    },
  });

  return (
    <main className="wrap" dir="rtl">
      <section className="glass hero">
        <span className="badge">MOD</span>
        <h1>Mods</h1>
        <p className="muted">
          قسم مخصص للمودات الموثقة داخل GameVortex. لا توجد عناصر منشورة حاليًا، ولن نملأه بمحتوى وهمي لمجرد أن الصفحة لا تبدو فارغة.
        </p>
      </section>

      {mods.length > 0 ? (
        <section className="grid">
          {mods.map((mod) => (
            <article className="glass card" key={mod.id}>
              {mod.imageUrl ? (
                <img src={mod.imageUrl} alt={mod.titleAr} style={{ width: "100%", aspectRatio: "16/9", objectFit: "cover", borderRadius: 16 }} />
              ) : null}
              <span className="badge">{mod.platform ? getPlatformSlugFromEnum(mod.platform) : "MULTI"}</span>
              <h2>{mod.titleAr}</h2>
              <p className="muted">{mod.titleEn}{mod.game ? ` · ${mod.game.titleEn}` : ""}</p>
              <p>{mod.descriptionAr || mod.descriptionEn || "Mod"}</p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {mod.modUrl ? <Link className="btn" href={mod.modUrl} target="_blank" rel="noreferrer">التفاصيل</Link> : null}
                {mod.downloadUrl ? <Link className="btn" href={mod.downloadUrl} target="_blank" rel="noreferrer">تنزيل</Link> : null}
              </div>
            </article>
          ))}
        </section>
      ) : (
        <section className="glass card" style={{ textAlign: "center", padding: 56 }}>
          <h2>قسم Mods جاهز</h2>
          <p className="muted">سيظهر المحتوى هنا بعد أن يضيفه المالك من لوحة الإدارة مع مصدر حقيقي.</p>
        </section>
      )}
    </main>
  );
}
