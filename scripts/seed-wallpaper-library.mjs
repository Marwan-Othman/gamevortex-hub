import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const categories = [
  "GAMING",
  "ANIME",
  "CYBERPUNK",
  "CARS",
  "SPORTS",
  "NATURE",
  "SPACE",
  "FANTASY",
  "ABSTRACT",
  "ARABIC",
  "ISLAMIC",
  "TECHNOLOGY",
  "MINIMAL",
  "AI",
  "NEON",
  "GAMEVORTEX",
];

function slug(i) {
  return `gamevortex-wallpaper-${String(i).padStart(4, "0")}`;
}

function dimensionsFor(i) {
  // The generated SVGs are portrait (1080x1920) when i % 3 === 0, else landscape (1920x1080).
  const mobile = i % 3 === 0;
  return mobile
    ? { mobile, width: 1080, height: 1920, type: "MOBILE", orientation: "PORTRAIT" }
    : { mobile, width: 1920, height: 1080, type: "DESKTOP", orientation: "LANDSCAPE" };
}

async function main() {
  for (let i = 1; i <= 1000; i += 1) {
    const category = categories[(i - 1) % categories.length];
    const { mobile, width, height, type, orientation } = dimensionsFor(i);
    const vip = i % 7 === 0;
    const featured = i <= 24;
    const path = `/wallpapers/generated/wallpaper-${String(i).padStart(4, "0")}.svg`;

    const tags = [
      category.toLowerCase(),
      mobile ? "mobile" : "desktop",
      vip ? "vip" : "free",
      "high-resolution",
      "gamevortex-original",
    ];

    await prisma.wallpaper.upsert({
      where: { slug: slug(i) },
      update: {
        imageUrl: path,
        thumbnailUrl: path,
        originalFilename: `gamevortex-wallpaper-${String(i).padStart(4, "0")}.svg`,
        mimeType: "image/svg+xml",
        isAnimated: false,
        width,
        height,
        resolution: `${width}x${height}`,
        isVip: vip,
        published: true,
        featured,
        category,
        type,
        deviceType: type,
        orientation,
        sourceStatus: "OFFICIAL_SOURCE",
        sourceProvider: "GameVortex Original Generator",
        sourceUrl: "https://gamevortex-hub.vercel.app/wallpapers",
        tags,
      },
      create: {
        titleAr: `خلفية GameVortex ${i}`,
        titleEn: `GameVortex Wallpaper ${i}`,
        slug: slug(i),
        descriptionAr: `خلفية أصلية عالية الدقة من مكتبة GameVortex، تصنيف ${category}.`,
        descriptionEn: `High-resolution original GameVortex wallpaper in the ${category} category.`,
        imageUrl: path,
        thumbnailUrl: path,
        originalFilename: `gamevortex-wallpaper-${String(i).padStart(4, "0")}.svg`,
        mimeType: "image/svg+xml",
        isAnimated: false,
        width,
        height,
        resolution: `${width}x${height}`,
        type,
        orientation,
        deviceType: type,
        category,
        tags,
        isVip: vip,
        published: true,
        featured,
        sourceStatus: "OFFICIAL_SOURCE",
        sourceProvider: "GameVortex Original Generator",
        sourceUrl: "https://gamevortex-hub.vercel.app/wallpapers",
        attribution: "GameVortex original procedural artwork",
      },
    });
  }

  console.log("Seeded 1000 GameVortex original high-resolution wallpapers: 333 mobile + 667 desktop.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
