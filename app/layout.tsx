import type { Viewport } from "next";
import { Cairo, Inter, Rajdhani } from "next/font/google";
import SiteHeader from "@/components/layout/SiteHeader";
import MobileBottomNav from "@/components/layout/MobileBottomNav";
import "./styles.css";
import "./design-system.css";

const fontDisplay = Rajdhani({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
  variable: "--font-display",
});

const fontBody = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-body",
});

const fontArabic = Cairo({
  subsets: ["arabic", "latin"],
  display: "swap",
  variable: "--font-arabic",
});

function getMetadataBase() {
  const origin = process.env.APP_ORIGIN?.trim();

  if (!origin) {
    return new URL("http://localhost:3000");
  }

  try {
    return new URL(origin);
  } catch {
    return new URL("http://localhost:3000");
  }
}

export const metadata = {
  title: "GameVortex Hub",
  description: "بوابتك الموحدة لجميع منصات الألعاب",
  metadataBase: getMetadataBase(),
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  colorScheme: "dark",
  themeColor: "#05030d",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ar"
      dir="rtl"
      className={`${fontDisplay.variable} ${fontBody.variable} ${fontArabic.variable}`}
    >
      <body>
        <SiteHeader />

        <main>{children}</main>

        <MobileBottomNav />

        <footer className="gv-footer">
          <strong>GAMEVORTEX HUB</strong>
          <span>بوابتك الموحدة لجميع منصات الألعاب</span>
        </footer>
      </body>
    </html>
  );
}
