"use client";

import { createContext } from "react";

export type ProviderLocale = "ar" | "en";

/**
 * The root layout already resolves the locale from the `selectedLanguage` cookie on the server.
 * Passing it down lets client components start with the SAME language the server rendered
 * (no English flash + hydration mismatch for Arabic visitors, which the old "en" default caused).
 */
export const LocaleContext = createContext<ProviderLocale>("ar");

export default function LocaleProvider({ locale, children }: { locale: ProviderLocale; children: React.ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}
