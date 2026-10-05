import { db } from "@/lib/prisma";
import WallpaperStudioClient from "./WallpaperStudioClient";

export const dynamic = "force-dynamic";

export default async function WallpaperStudioPage() {
  const wallpapers = await db.wallpaper.findMany({
    where: { published: true, mediaType: "IMAGE" },
    orderBy: [{ featured: "desc" }, { sortOrder: "asc" }, { createdAt: "desc" }],
    take: 24,
    select: {
      id: true,
      titleAr: true,
      titleEn: true,
      thumbnailUrl: true,
      imageUrl: true,
      width: true,
      height: true,
      isVip: true,
    },
  });

  const library = wallpapers.map((item) => ({
    id: item.id,
    title: item.titleAr || item.titleEn || "GameVortex",
    src: item.thumbnailUrl || item.imageUrl,
    width: item.width,
    height: item.height,
    isVip: item.isVip,
  }));

  return <WallpaperStudioClient library={library} />;
}
