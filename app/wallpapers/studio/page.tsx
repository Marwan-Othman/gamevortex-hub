import { getOptionalUser } from "@/lib/auth";
import { getVipAccess } from "@/lib/vip";
import { WALLPAPER_CATEGORIES } from "@/lib/wallpapers";
import WallpaperStudioPro from "./WallpaperStudioPro";
import StudioMergeImport from "./StudioMergeImport";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * الاستوديو مفتوح للجميع (حتى غير المسجل) بالأدوات الأساسية.
 * حالة VIP تُقرأ هنا من الخادم/قاعدة البيانات فقط وتُمرَّر للواجهة للعرض؛
 * الحماية الفعلية للملفات والحفظ تتم في واجهات API.
 * مكتبة الخلفيات تُحمَّل بصفحات من /api/wallpapers/studio/library.
 */
export default async function WallpaperStudioPage() {
  const user = await getOptionalUser();
  const vip = user ? await getVipAccess(user.id) : null;

  const initialPlayerName = (user?.username || "PLAYER").slice(0, 24).toUpperCase();

  return (
    <>
      <div className="wrap" dir="rtl" style={{ maxWidth: 1200, paddingTop: 18 }}>
        <Link href="/wallpapers/merge" className="btn secondary" style={{ display: "inline-flex" }}>
          ✨ Smart Merge — دمج عدة صور
        </Link>
      </div>
      <WallpaperStudioPro
        access={{ loggedIn: Boolean(user), isVip: Boolean(vip?.isVip), isOwner: Boolean(vip?.isOwner) }}
        categories={[...WALLPAPER_CATEGORIES]}
        initialPlayerName={initialPlayerName}
      />
      <StudioMergeImport />
    </>
  );
}
