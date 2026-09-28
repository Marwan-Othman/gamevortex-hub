import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "GameVortex Hub",
    short_name: "GameVortex",
    description: "GameVortex Hub: games, apps, library, VIP, rewards and more.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#0A0C10",
    theme_color: "#0A0C10",
    lang: "ar",
    dir: "rtl",
    categories: ["games", "entertainment"],
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
