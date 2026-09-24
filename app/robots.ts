import { MetadataRoute } from "next";
export default function robots(): MetadataRoute.Robots {
  const base = (process.env.APP_ORIGIN || "http://localhost:3000").replace(/\/$/, "");
  return { rules: [{ userAgent: "*", allow: ["/", "/games", "/quran", "/gamer/"] , disallow: ["/admin", "/api", "/profile", "/social"] }], sitemap: `${base}/sitemap.xml` };
}
