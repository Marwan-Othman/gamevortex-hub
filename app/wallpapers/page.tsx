export const dynamic = "force-dynamic";

import Link from "next/link";
import { db } from "../../lib/prisma";
import { getOptionalUser } from "../../lib/auth";
import { getVipAccess } from "../../lib/vip";
import LocaleText from "@/components/ui/LocaleText";

const categories = [
  ["", "الكل", "All"], ["GAMING", "ألعاب", "Gaming"], ["ANIME", "أنمي", "Anime"],
  ["CYBERPUNK", "سايبر", "Cyberpunk"], ["CARS", "سيارات", "Cars"], ["NATURE", "طبيعة", "Nature"],
  ["SPACE", "فضاء", "Space"], ["FANTASY", "فانتازيا", "Fantasy"], ["ARABIC", "عربي", "Arabic"],
  ["ISLAMIC", "إسلامي", "Islamic"], ["ABSTRACT", "مجرد", "Abstract"], ["MINIMAL", "بسيط", "Minimal"],
];

export default async function Wallpapers({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const user = await getOptionalUser();
  const vip = user ? await getVipAccess(user.id) : null;
  const type = params.type === "MOBILE" || params.type === "DESKTOP" ? params.type : undefined;
  const category = params.category?.trim().toUpperCase() || undefined;
  const q = params.q?.trim().slice(0, 80) || undefined;
  const access = params.access === "VIP" ? true : params.access === "FREE" ? false : undefined;
  const featured = params.featured === "true";
  const page = Math.max(1, Number(params.page || 1) || 1);
  const pageSize = 24;

  const where = {
    published: true,
    ...(type ? { type } : {}),
    ...(category ? { category } : {}),
    ...(access !== undefined ? { isVip: access } : {}),
    ...(featured ? { featured: true } : {}),
    ...(q ? { OR: [
      { titleAr: { contains: q, mode: "insensitive" as const } },
      { titleEn: { contains: q, mode: "insensitive" as const } },
      { descriptionAr: { contains: q, mode: "insensitive" as const } },
      { descriptionEn: { contains: q, mode: "insensitive" as const } },
    ] } : {}),
  };

  const [wallpapers, total] = await Promise.all([
    db.wallpaper.findMany({ where, orderBy: [{ featured: "desc" }, { sortOrder: "asc" }, { createdAt: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
    db.wallpaper.count({ where }),
  ]);

  function href(overrides: Record<string, string | undefined>) {
    const next = new URLSearchParams();
    const values = { q, type, category, access: params.access, featured: featured ? "true" : undefined, ...overrides };
    for (const [key, value] of Object.entries(values)) if (value) next.set(key, value);
    return `/wallpapers${next.toString() ? `?${next}` : ""}`;
  }

  const maxPage = Math.max(1, Math.ceil(total / pageSize));

  return (
    <main className="wrap">
      <section className="glass hero">
        <p className="muted">GAMEVORTEX WALLPAPERS</p>
        <LocaleText as="h1" ar="مكتبة خلفيات GameVortex" en="GameVortex Wallpaper Library" />
        <p className="muted"><LocaleText as="span" ar="خلفيات مجانية، خلفيات VIP، ومحتوى أصلي قابل للتوسع إلى آلاف الصور." en="Free wallpapers, VIP wallpapers, and original content built to scale to thousands of images." /></p>

        <form method="get" className="filter-row" style={{ marginTop: 16 }}>
          <input className="input" name="q" defaultValue={q || ""} placeholder="ابحث عن Gaming, Cyberpunk..." aria-label="Search wallpapers" />
          {type && <input type="hidden" name="type" value={type} />}
          {category && <input type="hidden" name="category" value={category} />}
          <button className="btn" type="submit">🔎 بحث</button>
        </form>

        <div className="platform-list" style={{ marginTop: 14 }}>
          {categories.map(([value, ar, en]) => <Link key={value} href={href({ category: value || undefined, page: "1" })} className={`platform-chip ${category === (value || undefined) ? "active" : ""}`}><LocaleText ar={ar} en={en} /></Link>)}
        </div>
        <div className="platform-list" style={{ marginTop: 10 }}>
          <Link href={href({ access: undefined, page: "1" })} className={`platform-chip ${!params.access ? "active" : ""}`}>كل المحتوى</Link>
          <Link href={href({ access: "FREE", page: "1" })} className={`platform-chip ${params.access === "FREE" ? "active" : ""}`}>🆓 مجاني</Link>
          <Link href={href({ access: "VIP", page: "1" })} className={`platform-chip ${params.access === "VIP" ? "active" : ""}`}>💎 VIP</Link>
          <Link href={href({ type: "MOBILE", page: "1" })} className={`platform-chip ${type === "MOBILE" ? "active" : ""}`}>📱 Mobile</Link>
          <Link href={href({ type: "DESKTOP", page: "1" })} className={`platform-chip ${type === "DESKTOP" ? "active" : ""}`}>🖥️ Desktop</Link>
          <Link href={href({ featured: "true", page: "1" })} className={`platform-chip ${featured ? "active" : ""}`}>⭐ مميزة</Link>
        </div>
        {vip?.isVip && <p className="badge" style={{ display: "inline-block", marginTop: 12 }}>💎 VIP مفعل</p>}
      </section>

      <section className="grid" style={{ marginTop: 20 }}>
        {wallpapers.map((wallpaper) => {
          const isMobile = wallpaper.type === "MOBILE";
          return <Link key={wallpaper.id} href={`/wallpapers/${wallpaper.id}`} className="glass card game-card" style={{ overflow: "hidden", padding: 0 }}>
            <div style={{ position: "relative", width: "100%", overflow: "hidden", background: "rgba(255,255,255,0.04)" }}>
              {wallpaper.mediaType === "VIDEO" && wallpaper.mediaUrl ? <video src={wallpaper.mediaUrl} poster={wallpaper.thumbnailUrl || wallpaper.imageUrl} muted playsInline preload="metadata" style={{ display: "block", width: "100%", aspectRatio: isMobile ? "9 / 16" : "16 / 9", objectFit: "cover" }} /> : <img src={wallpaper.thumbnailUrl || wallpaper.imageUrl} alt={wallpaper.titleEn} loading="lazy" decoding="async" style={{ display: "block", width: "100%", aspectRatio: isMobile ? "9 / 16" : "16 / 9", objectFit: "cover" }} />}
              <div style={{ position: "absolute", inset: "12px 12px auto", display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <span className="badge">{isMobile ? "📱 MOBILE" : "🖥️ DESKTOP"}</span>
                {wallpaper.isVip && <span className="badge">💎 VIP</span>} {wallpaper.mediaType === "VIDEO" && <span className="badge">🎬 VIDEO</span>}
                {wallpaper.featured && <span className="badge">⭐ FEATURED</span>}
              </div>
            </div>
            <div style={{ padding: 16 }}>
              <LocaleText as="h2" ar={wallpaper.titleAr} en={wallpaper.titleEn} />
              <p className="muted" style={{ marginTop: 8 }}>{wallpaper.category} · 👁️ {wallpaper.viewCount} · ↓ {wallpaper.downloadCount}</p>
              {wallpaper.tags.length > 0 && <div className="platform-list" style={{ marginTop: 8 }}><span className="badge">#{wallpaper.tags[0]}</span><span className="badge">{wallpaper.tags.length} tags</span></div>}
            </div>
          </Link>;
        })}
      </section>

      {!wallpapers.length && <section className="glass card" style={{ marginTop: 20 }}><LocaleText as="h2" ar="لا توجد نتائج" en="No results" /><p className="muted">جرّب إزالة فلتر أو تغيير كلمة البحث.</p></section>}

      {maxPage > 1 && <nav className="platform-list" style={{ marginTop: 22, justifyContent: "center" }} aria-label="Pagination">
        {page > 1 && <Link className="platform-chip" href={href({ page: String(page - 1) })}>← السابق</Link>}
        <span className="badge">{page} / {maxPage}</span>
        {page < maxPage && <Link className="platform-chip" href={href({ page: String(page + 1) })}>التالي →</Link>}
      </nav>}
    </main>
  );
}
