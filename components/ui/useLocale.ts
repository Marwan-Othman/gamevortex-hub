"use client";

import { useEffect, useState } from "react";

export type Locale = "ar" | "en";

export function readLocale(): Locale {
  if (typeof window === "undefined") return "en";
  const stored = localStorage.getItem("selectedLanguage");
  if (stored === "ar" || stored === "en") return stored;
  return navigator.language.toLowerCase().startsWith("ar") ? "ar" : "en";
}

export function useLocale() {
  const [locale, setLocale] = useState<Locale>("en");

  useEffect(() => {
    const sync = () => setLocale(readLocale());
    sync();
    window.addEventListener("gv-language-change", sync);
    return () => window.removeEventListener("gv-language-change", sync);
  }, []);

  return locale;
}

