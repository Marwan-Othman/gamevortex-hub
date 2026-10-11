/** @type {import('next').NextConfig} */
const isProduction = process.env.NODE_ENV === "production";

// blob: is required for client-side previews (URL.createObjectURL) in the upload,
// wallpaper studio and smart-merge screens. The MediaPipe segmenter loads its
// WebAssembly runtime from jsDelivr and needs 'wasm-unsafe-eval' plus a blob worker.
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' https: data: blob:",
  "font-src 'self' data:",
  "media-src 'self' https: blob:",
  "connect-src 'self' https:",
  "style-src 'self' 'unsafe-inline'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net${isProduction ? "" : " 'unsafe-eval'"}`,
  "worker-src 'self' blob:",
].join("; ");

const nextConfig = {
  poweredByHeader: false,
  compress: true,
  images: { formats: ["image/avif", "image/webp"] },
  async headers() {
    const securityHeaders = [
      { key: "Content-Security-Policy", value: contentSecurityPolicy },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ...(process.env.NODE_ENV === "production"
        ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
        : []),
    ];
    // Static files in /public have stable URLs but are not content-hashed, so give them a day of
    // browser/CDN caching and let stale copies be served while revalidating (Phase 16).
    const staticAssetCache = [
      { key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" },
    ];
    return [
      { source: "/(.*)", headers: securityHeaders },
      { source: "/images/:path*", headers: staticAssetCache },
      { source: "/wallpapers/generated/:path*", headers: staticAssetCache },
      { source: "/icon-:size.png", headers: staticAssetCache },
      { source: "/apple-touch-icon.png", headers: staticAssetCache },
    ];
  },
};

export default nextConfig;
