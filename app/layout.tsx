import SiteHeader from "@/components/layout/SiteHeader";
import MobileBottomNav from "@/components/layout/MobileBottomNav";
import SiteFooter from "@/components/layout/SiteFooter";
import PwaRegister from "@/components/pwa/PwaRegister";
import "./styles.css";

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

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#071426",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl">
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
