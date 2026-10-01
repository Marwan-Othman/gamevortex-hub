export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "../../../lib/prisma";
import { getOptionalUser } from "../../../lib/auth";
import { getVipAccess } from "../../../lib/vip";

export default async function FavoriteWallpapersPage() {
  const user = await getOptionalUser();
  if (!user) redirect("/login?next=/wallpapers/favorites");

  const vip = await getVipAccess(user.id);
  const favorites = await db.wallpaperFavorite.findMany({
    where: { userId: user.id, wallpaper: { published: true } },
    orderBy: { createdAt: "desc" },
    include: { wallpaper: true },
    take: 500,
  });

  return <main className="wrap">
    <section className="glass hero">
      <p className="muted">GAMEVORTEX</p>
      <h1>❤️ خلفياتي المحفوظة</h1>
      <p className="muted">الخلفيات التي حفظتها لحسابك.</p>
      <Link className="btn secondary" href="/wallpapers">← العودة للمكتبة</Link>
    </section>
    <section className="grid" style={{ marginTop: 20 }}>
      {favorites.map(({ wallpaper }) => <Link key={wallpaper.id} href={`/wallpapers/${wallpaper.id}`} className="glass card game-card" style={{ overflow: "hidden", padding: 0 }}>
        <img src={wallpaper.isVip && !vip.isVip ? "/icon.svg" : `/api/wallpapers/${wallpaper.id}/media`} alt={wallpaper.titleEn} loading="lazy" style={{ width: "100%", aspectRatio: wallpaper.width && wallpaper.height ? `${wallpaper.width} / ${wallpaper.height}` : wallpaper.type === "MOBILE" ? "9/16" : "16/9", objectFit: "contain", background: "rgba(0,0,0,.28)" }} />
        <div style={{ padding: 14 }}><strong>{wallpaper.titleAr}</strong>{wallpaper.isVip && <span className="badge" style={{ marginInlineStart: 8 }}>💎 VIP</span>}</div>
      </Link>)}
    </section>
    {!favorites.length && <section className="glass card" style={{ marginTop: 20 }}><h2>لا توجد خلفيات محفوظة</h2><p className="muted">ابدأ بحفظ الخلفيات التي تعجبك.</p></section>}
  </main>;
}
