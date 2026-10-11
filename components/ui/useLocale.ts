"use client";

import { useContext, useEffect, useState } from "react";
import { LocaleContext } from "./LocaleProvider";

export type Locale = "ar" | "en";

export function readLocale(): Locale {
  if (typeof window === "undefined") return "en";
  const stored = localStorage.getItem("selectedLanguage");
  if (stored === "ar" || stored === "en") return stored;
  return navigator.language.toLowerCase().startsWith("ar") ? "ar" : "en";
}

export function useLocale() {
  // Start from the locale the server rendered (cookie) so first paint and hydration agree.
  const initial = useContext(LocaleContext);
  const [locale, setLocale] = useState<Locale>(initial);

  useEffect(() => {
    const sync = () => setLocale(readLocale());
    sync();
    window.addEventListener("gv-language-change", sync);
    return () => window.removeEventListener("gv-language-change", sync);
  }, []);

  return locale;
}

