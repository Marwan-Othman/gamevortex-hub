import { getServerLocale } from "@/lib/server-locale";

type TextTag = "span" | "p" | "strong" | "small" | "h1" | "h2" | "h3" | "option";

/**
 * Server Component (Phase 16). It used to be a Client Component, which meant every label on a
 * page (dozens on /games) shipped its own client island, hydrated, and ran an effect. The locale
 * already comes from the `selectedLanguage` cookie that the root layout reads, so it is resolved
 * on the server and no JavaScript is sent. LanguageSwitcher refreshes the route when the language
 * changes.
 */
export default async function LocaleText({ ar, en, as: Tag = "span", value }: { ar: string; en: string; as?: TextTag; value?: string }) {
  const locale = await getServerLocale();
  return <Tag lang={locale} dir={locale === "ar" ? "rtl" : "ltr"} {...(Tag === "option" ? { value: value ?? ar } : {})}>{locale === "ar" ? ar : en}</Tag>;
}
