import { cookies } from "next/headers";
import SiteHeader from "@/components/layout/SiteHeader";
import MobileBottomNav from "@/components/layout/MobileBottomNav";
import SiteFooter from "@/components/layout/SiteFooter";
import PwaRegister from "@/components/pwa/PwaRegister";
import { Tajawal, Cairo } from "next/font/google";
import "./styles.css";
import "./theme.css";
import "./redesign.css";

const fontDisplay = Tajawal({ subsets: ["arabic", "latin"], weight: ["700", "800", "900"], variable: "--font-display", display: "swap" });
const fontBody = Cairo({ subsets: ["arabic", "latin"], weight: ["400", "500", "600", "700"], variable: "--font-body", display: "swap" });

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
  icons: {
    icon: "/icon.svg",
    apple: "/apple-touch-icon.png",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#0A0C10",
  colorScheme: "dark",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const savedLanguage = cookieStore.get("selectedLanguage")?.value;
  const locale = savedLanguage === "en" ? "en" : "ar";
  const dir = locale === "ar" ? "rtl" : "ltr";

  return (
    <html lang={locale} dir={dir} className={`${fontDisplay.variable} ${fontBody.variable}`}>
      <body>
        <SiteHeader />

        <PwaRegister />

        <main className="gv-app-main">{children}</main>

        <MobileBottomNav />

        <SiteFooter />
      </body>
    </html>
  );
}
