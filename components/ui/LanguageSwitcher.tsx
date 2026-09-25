 "use client";

import { useEffect, useState } from "react";

export default function LanguageSwitcher() {
  const [language, setLanguage] = useState<"ar" | "en">("ar");

  useEffect(() => {
    const saved = (localStorage.getItem("selectedLanguage") as "ar" | "en" | null) || "ar";
    apply(saved);
  }, []);

  function apply(next: "ar" | "en") {
    setLanguage(next);
    document.documentElement.lang = next;
    document.documentElement.dir = next === "ar" ? "rtl" : "ltr";
    localStorage.setItem("selectedLanguage", next);
    window.dispatchEvent(new Event("gv-language-change"));
  }

  return (
    <div className="language-switcher" aria-label="Language">
      <button type="button" onClick={() => apply("ar")} aria-pressed={language === "ar"}>العربية</button>
      <button type="button" onClick={() => apply("en")} aria-pressed={language === "en"}>English</button>
    </div>
  );
}
