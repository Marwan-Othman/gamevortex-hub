"use client";

import { useLocale } from "@/components/ui/useLocale";

export default function SiteFooter() {
  const locale = useLocale();
  const english = locale === "en";
  return <footer className="gv-footer" lang={locale} dir={english ? "ltr" : "rtl"}>
    <strong>GAMEVORTEX HUB</strong>
    <span>{english ? "Your unified gaming hub" : "بوابتك الموحدة لجميع منصات الألعاب"}</span>
  </footer>;
}
