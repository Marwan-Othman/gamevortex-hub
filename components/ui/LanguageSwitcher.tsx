 "use client";

import { useEffect, useState } from "react";

export default function LanguageSwitcher() {
  const [language, setLanguage] = useState<"ar" | "en">("ar");

  useEffect(() => {
    const stored = localStorage.getItem("selectedLanguage") as "ar" | "en" | null;
    const device = navigator.language.toLowerCase().startsWith("ar") ? "ar" : "en";
    const saved = stored || device;
    setLanguage(saved);
    document.documentElement.lang = saved;
    document.documentElement.dir = saved === "ar" ? "rtl" : "ltr";
    const sync = () => {
      const stored = localStorage.getItem("selectedLanguage") as "ar" | "en" | null;
      setLanguage(stored || (navigator.language.toLowerCase().startsWith("ar") ? "ar" : "en"));
    };
    window.addEventListener("gv-language-change", sync);
    return () => window.removeEventListener("gv-language-change", sync);
  }, []);

  function apply(next: "ar" | "en") {
    setLanguage(next);
    document.documentElement.lang = next;
    document.documentElement.dir = next === "ar" ? "rtl" : "ltr";
    localStorage.setItem("selectedLanguage", next);
    document.cookie = `selectedLanguage=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
    window.dispatchEvent(new Event("gv-language-change"));
  }

  return (
    <div className="language-switcher" aria-label={language === "ar" ? "تغيير اللغة" : "Change language"}>
      <button type="button" onClick={() => apply("ar")} aria-pressed={language === "ar"}>العربية</button>
      <button type="button" onClick={() => apply("en")} aria-pressed={language === "en"}>English</button>
    </div>
  );
}
