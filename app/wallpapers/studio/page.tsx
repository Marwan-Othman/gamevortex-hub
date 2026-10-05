import { db } from "@/lib/prisma";
import { getOptionalUser } from "@/lib/auth";
import { getVipAccess } from "@/lib/vip";
import WallpaperStudioPro from "./WallpaperStudioPro";
import StudioMergeImport from "./StudioMergeImport";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function WallpaperStudioPage() {
  const user = await getOptionalUser();
  const vip = user ? await getVipAccess(user.id) : null;
  const wallpapers = await db.wallpaper.findMany({
    where: { published: true, mediaType: "IMAGE", ...(vip?.isVip ? {} : { isVip: false }) },
    orderBy: [{ featured: "desc" }, { sortOrder: "asc" }, { createdAt: "desc" }],
    take: 24,
    select: {
      id: true,
      titleAr: true,
      titleEn: true,
      width: true,
      height: true,
      isVip: true,
    },
  });

  const library = wallpapers.map((item) => ({
    id: item.id,
    title: item.titleAr || item.titleEn || "GameVortex",
    src: `/api/wallpapers/${item.id}/media`,
    isVip: item.isVip,
  }));

  return (
    <>
      <div className="wrap" dir="rtl" style={{ maxWidth: 1200, paddingTop: 18 }}>
        <a href="/wallpapers/merge" className="btn secondary" style={{ display: "inline-flex" }}>
          ✨ Smart Merge — دمج عدة صور
        </a>
      </div>
      <WallpaperStudioPro library={library} />
      <StudioMergeImport />
    </>
  );
}
