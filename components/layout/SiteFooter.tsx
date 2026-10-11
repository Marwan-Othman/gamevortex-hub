import { getServerLocale } from "@/lib/server-locale";

export default async function SiteFooter() {
  const locale = await getServerLocale();
  const english = locale === "en";
  return <footer className="gv-footer" lang={locale} dir={english ? "ltr" : "rtl"}>
    <strong>GAMEVORTEX HUB</strong>
    <span>{english ? "Your unified gaming hub" : "بوابتك الموحدة لجميع منصات الألعاب"}</span>
  </footer>;
}
