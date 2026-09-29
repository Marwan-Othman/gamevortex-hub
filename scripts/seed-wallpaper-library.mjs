import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const categories = ["GAMING","ANIME","CYBERPUNK","CARS","SPORTS","NATURE","SPACE","FANTASY","ABSTRACT","ARABIC","ISLAMIC","TECHNOLOGY","MINIMAL","AI","NEON","GAMEVORTEX"];

function slug(i) { return `gamevortex-wallpaper-${String(i).padStart(4, "0")}`; }

async function main() {
  for (let i = 1; i <= 1000; i++) {
    const mobile = i % 3 === 0;
    const vip = i % 7 === 0;
    const category = categories[(i - 1) % categories.length];
    const path = `/wallpapers/generated/wallpaper-${String(i).padStart(4, "0")}.svg`;
    await prisma.wallpaper.upsert({
      where: { slug: slug(i) },
      update: { imageUrl: path, thumbnailUrl: path, isVip: vip, category, type: mobile ? "MOBILE" : "DESKTOP", deviceType: mobile ? "MOBILE" : "DESKTOP", orientation: mobile ? "PORTRAIT" : "LANDSCAPE", published: true, sourceStatus: "OFFICIAL_SOURCE", sourceProvider: "GameVortex Original Generator", sourceUrl: "https://gamevortex-hub.vercel.app/wallpapers", tags: [category.toLowerCase(), mobile ? "mobile" : "desktop", vip ? "vip" : "free"] },
      create: { titleAr: `خلفية GameVortex ${i}`, titleEn: `GameVortex Wallpaper ${i}`, slug: slug(i), descriptionAr: `خلفية أصلية مولدة لنظام GameVortex، تصنيف ${category}.`, descriptionEn: `Original procedural GameVortex wallpaper in the ${category} category.`, imageUrl: path, thumbnailUrl: path, type: mobile ? "MOBILE" : "DESKTOP", orientation: mobile ? "PORTRAIT" : "LANDSCAPE", deviceType: mobile ? "MOBILE" : "DESKTOP", category, tags: [category.toLowerCase(), mobile ? "mobile" : "desktop", vip ? "vip" : "free"], resolution: mobile ? "1080x1920" : "1920x1080", isVip: vip, published: true, featured: i <= 24, sourceStatus: "OFFICIAL_SOURCE", sourceProvider: "GameVortex Original Generator", sourceUrl: "https://gamevortex-hub.vercel.app/wallpapers", attribution: "GameVortex original procedural artwork" },
    });
  }
  console.log("Seeded 1000 GameVortex original wallpapers; approximately 1/7 are VIP.");
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
