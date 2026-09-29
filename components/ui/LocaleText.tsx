"use client";

import { useLocale } from "./useLocale";

type TextTag = "span" | "p" | "strong" | "small" | "h1" | "h2" | "h3" | "option";

export default function LocaleText({ ar, en, as: Tag = "span", value }: { ar: string; en: string; as?: TextTag; value?: string }) {
  const locale = useLocale();
  return <Tag lang={locale} dir={locale === "ar" ? "rtl" : "ltr"} {...(Tag === "option" ? { value: value ?? ar } : {})}>{locale === "ar" ? ar : en}</Tag>;
}
