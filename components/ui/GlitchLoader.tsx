 "use client";

import { useEffect, useState } from "react";

export default function GlitchLoader() {
  const [language, setLanguage] = useState<"ar" | "en">("ar");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const saved = (localStorage.getItem("selectedLanguage") as "ar" | "en" | null) || "ar";
    setLanguage(saved);
    setLoading(false);
  }, []);

  if (loading) return <div className="glitch-loader" aria-hidden="true" />;

  const text = language === "ar" ? "ألعاب لجميع المنصات" : "Games for All Platforms";
  return (
    <div
      className="glitch"
      data-glitch={text}
      dir={language === "ar" ? "rtl" : "ltr"}
      lang={language}
      aria-label={text}
    >
      {text}
    </div>
  );
}
