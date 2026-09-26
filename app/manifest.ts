import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "GameVortex Hub",
    short_name: "GameVortex",
    description: "GameVortex Hub: games, apps, library, VIP, rewards and more.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#030914",
    theme_color: "#071426",
    lang: "ar",
    dir: "rtl",
    categories: ["games", "entertainment"],
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
