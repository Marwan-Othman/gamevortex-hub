"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Lang = "ar" | "en";

function readCookieLanguage(): Lang | null {
  const match = document.cookie.match(/(?:^|;\s*)selectedLanguage=(ar|en)/);
  return match ? (match[1] as Lang) : null;
}

function writeCookie(next: Lang) {
  document.cookie = `selectedLanguage=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
}

export default function LanguageSwitcher() {
  const router = useRouter();
  const [language, setLanguage] = useState<Lang>("ar");

  useEffect(() => {
    const stored = localStorage.getItem("selectedLanguage") as Lang | null;
    const device: Lang = navigator.language.toLowerCase().startsWith("ar") ? "ar" : "en";
    const saved = stored || device;
    setLanguage(saved);
    document.documentElement.lang = saved;
    document.documentElement.dir = saved === "ar" ? "rtl" : "ltr";

    // Server Components render from the cookie (anything but "en" means Arabic). If the visitor's
    // saved/device language disagrees with what the server rendered, sync the cookie once and refresh.
    const rendered: Lang = readCookieLanguage() === "en" ? "en" : "ar";
    if (saved !== rendered) {
      writeCookie(saved);
      router.refresh();
    }

    const sync = () => {
      const next = localStorage.getItem("selectedLanguage") as Lang | null;
      setLanguage(next || (navigator.language.toLowerCase().startsWith("ar") ? "ar" : "en"));
    };
    window.addEventListener("gv-language-change", sync);
    return () => window.removeEventListener("gv-language-change", sync);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function apply(next: Lang) {
    if (next === language) return;
    setLanguage(next);
    document.documentElement.lang = next;
    document.documentElement.dir = next === "ar" ? "rtl" : "ltr";
    localStorage.setItem("selectedLanguage", next);
    writeCookie(next);
    window.dispatchEvent(new Event("gv-language-change"));
    // Re-render Server Components (LocaleText, GameRow, footer, ...) with the new cookie.
    router.refresh();
  }

  return (
    <div className="language-switcher" aria-label={language === "ar" ? "تغيير اللغة" : "Change language"}>
      <button type="button" onClick={() => apply("ar")} aria-pressed={language === "ar"}>العربية</button>
      <button type="button" onClick={() => apply("en")} aria-pressed={language === "en"}>English</button>
    </div>
  );
}
