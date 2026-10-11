import { cookies } from "next/headers";

export type ServerLocale = "ar" | "en";

/** Same rule as app/layout.tsx: only an explicit "en" cookie switches to English. */
export async function getServerLocale(): Promise<ServerLocale> {
  const store = await cookies();
  return store.get("selectedLanguage")?.value === "en" ? "en" : "ar";
}
