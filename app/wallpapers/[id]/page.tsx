export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "../../../lib/prisma";
import { getOptionalUser } from "../../../lib/auth";
import { getVipAccess } from "../../../lib/vip";
import LocaleText from "@/components/ui/LocaleText";
import WallpaperViewTracker from "./WallpaperViewTracker";
import FavoriteButton from "../FavoriteButton";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const wallpaper = await db.wallpaper.findUnique({ where: { id }, select: { titleAr: true, titleEn: true, descriptionAr: true, descriptionEn: true, imageUrl: true } });
  if (!wallpaper) return { title: "Wallpaper | GameVortex" };
  return {
    title: `${wallpaper.titleEn} | GameVortex Wallpapers`,
    description: wallpaper.descriptionEn || wallpaper.descriptionAr || "GameVortex wallpaper",
    openGraph: { title: wallpaper.titleEn, description: wallpaper.descriptionEn || wallpaper.descriptionAr || "GameVortex wallpaper", images: [wallpaper.imageUrl] },
  };
}

export default async function WallpaperDetails({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const wallpaper = await db.wallpaper.findUnique({ where: { id } });
  if (!wallpaper || !wallpaper.published || wallpaper.moderationStatus !== "APPROVED") notFound();

  const user = await getOptionalUser();
  const vip = user ? await getVipAccess(user.id) : null;
  const canDownload = !wallpaper.isVip || Boolean(vip?.isVip);
  const favorite = user ? await db.wallpaperFavorite.findUnique({ where: { userId_wallpaperId: { userId: user.id, wallpaperId: wallpaper.id } }, select: { id: true } }) : null;
  const related = await db.wallpaper.findMany({
    where: { published: true, id: { not: wallpaper.id }, category: wallpaper.category },
    orderBy: [{ featured: "desc" }, { createdAt: "desc" }],
    take: 4,
    select: { id: true, titleAr: true, titleEn: true, imageUrl: true, thumbnailUrl: true, type: true, isVip: true, width: true, height: true, isAnimated: true },
  });

  const isMobile = wallpaper.type === "MOBILE";
  return (
    <main className="wrap">
      <WallpaperViewTracker wallpaperId={wallpaper.id} />
      <div style={{ marginBottom: 18 }}><Link href="/wallpapers" className="btn">← <LocaleText ar="العودة للخلفيات" en="Back to wallpapers" /></Link></div>

      <section className="glass card">
        <div className="wallpaper-detail-grid">
          <div className="wallpaper-detail-media">
            {wallpaper.mediaType === "VIDEO" && wallpaper.mediaUrl ? <video src={wallpaper.mediaUrl} poster={wallpaper.imageUrl} controls playsInline preload="metadata" style={{ display: "block", width: "100%", maxHeight: "78vh", objectFit: "contain", borderRadius: 14, background: "rgba(0,0,0,.25)" }} /> : <img src={wallpaper.imageUrl} alt={wallpaper.titleEn} fetchPriority="high" style={{ display: "block", width: "100%", maxHeight: "78vh", objectFit: "contain", borderRadius: 14, background: "rgba(0,0,0,.25)" }} />}
          </div>

          <div>
            <div className="card-top" style={{ marginBottom: 12 }}>
              <span className="badge">{isMobile ? "📱 MOBILE" : "🖥️ DESKTOP"}</span>
              {wallpaper.isVip && <span className="badge">💎 VIP</span>}
              {wallpaper.featured && <span className="badge">⭐ FEATURED</span>} {wallpaper.isAnimated && <span className="badge">🎞️ متحركة</span>} {wallpaper.mediaType === "VIDEO" && <span className="badge">🎬 VIDEO</span>}
            </div>
            <LocaleText as="h1" ar={wallpaper.titleAr} en={wallpaper.titleEn} />
            {(wallpaper.descriptionAr || wallpaper.descriptionEn) && <p className="muted" style={{ lineHeight: 1.8 }}>{wallpaper.descriptionAr || wallpaper.descriptionEn}</p>}

            <div className="glass" style={{ padding: 14, marginTop: 18, display: "grid", gap: 10 }}>
              <div className="card-top"><span className="muted">النوع</span><strong>{isMobile ? "Mobile" : "Desktop"}</strong></div>
              <div className="card-top"><span className="muted">التصنيف</span><strong>{wallpaper.category}</strong></div>
              {wallpaper.resolution && <div className="card-top"><span className="muted">الدقة</span><strong>{wallpaper.resolution}</strong></div>}
              <div className="card-top"><span className="muted">المشاهدات</span><strong>{wallpaper.viewCount}</strong></div>
              <div className="card-top"><span className="muted">التحميلات</span><strong>{wallpaper.downloadCount}</strong></div>
            </div>

            {wallpaper.tags.length > 0 && <div className="platform-list" style={{ marginTop: 14 }}>{wallpaper.tags.map(tag => <span className="badge" key={tag}>#{tag}</span>)}</div>}

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 20 }}>
              {user && <FavoriteButton wallpaperId={wallpaper.id} initialFavorited={Boolean(favorite)} />}
              {canDownload ? <a href={`/api/wallpapers/${wallpaper.id}/download`} className="btn">↓ تحميل الخلفية</a> : <Link href="/vip" className="btn">💎 افتح VIP للتحميل</Link>}
              <Link href="/wallpapers" className="btn secondary">استكشف المزيد</Link>
            </div>
            {!canDownload && <p className="muted" style={{ marginTop: 10 }}>هذه الخلفية مخصصة لأعضاء VIP. التحقق يتم على الخادم عند التحميل.</p>}
          </div>
        </div>
      </section>

      {related.length > 0 && <section style={{ marginTop: 28 }}><div className="section-head"><h2>خلفيات مشابهة</h2></div><div className="grid">{related.map(item => <Link key={item.id} href={`/wallpapers/${item.id}`} className="glass card game-card" style={{ overflow: "hidden", padding: 0 }}><img src={item.thumbnailUrl || item.imageUrl} alt={item.titleEn} loading="lazy" style={{ width: "100%", aspectRatio: item.width && item.height ? `${item.width} / ${item.height}` : item.type === "MOBILE" ? "9/16" : "16/9", objectFit: "contain", background: "rgba(0,0,0,.28)" }} /><div style={{ padding: 12 }}><strong>{item.titleAr}</strong>{item.isVip && <span className="badge" style={{ marginInlineStart: 8 }}>💎 VIP</span>}</div></Link>)}</div></section>}
    </main>
  );
}
