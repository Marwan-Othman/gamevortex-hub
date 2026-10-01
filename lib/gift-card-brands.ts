// Pure helpers (no database access) so they can be used in server AND client components.

/** "App Store & iTunes (PL)" -> { brand: "App Store & iTunes", region: "PL" } */
export function splitCategoryName(categoryName: string): { brand: string; region: string | null } {
  const match = categoryName.trim().match(/^(.*?)\s*\(([^()]+)\)\s*$/);
  if (match && match[1]) {
    return { brand: match[1].trim(), region: match[2].trim() };
  }
  return { brand: categoryName.trim(), region: null };
}

export function brandSlug(brand: string): string {
  const slug = brand
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "other";
}

/** "App Store & iTunes (PL) - 25 PLN" -> "25 PLN" */
export function cardLabel(title: string): string {
  const parts = title.split(" - ");
  return parts.length > 1 ? parts.slice(1).join(" - ") : title;
}

/** Stable gradient colours per brand so every brand tile looks different. */
export function brandTint(seed: string): { from: string; to: string } {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  return {
    from: `hsl(${hue} 78% 58%)`,
    to: `hsl(${(hue + 55) % 360} 78% 46%)`,
  };
}

export function formatPrice(priceCents: number, currency: string): string {
  const amount = (priceCents / 100).toFixed(2);
  return currency === "USD" ? `$${amount}` : `${amount} ${currency}`;
}

type DisplayNamesCtor = new (
  locales: string[],
  options: { type: "region" },
) => { of(code: string): string | undefined };

export function regionInfo(region: string | null): { code: string; flag: string; name: string } {
  if (!region || region.toLowerCase() === "global") {
    return { code: "GLOBAL", flag: "🌐", name: "عالمي" };
  }

  const code = region.trim().toUpperCase();
  const iso = code === "UK" ? "GB" : code;

  if (/^[A-Z]{2}$/.test(iso)) {
    const flag = String.fromCodePoint(
      ...iso.split("").map((char) => 0x1f1e6 + char.charCodeAt(0) - 65),
    );
    let name = region;
    try {
      const Ctor = (Intl as unknown as { DisplayNames?: DisplayNamesCtor }).DisplayNames;
      if (Ctor) name = new Ctor(["ar"], { type: "region" }).of(iso) ?? region;
    } catch {
      name = region;
    }
    return { code, flag, name };
  }

  return { code, flag: "🎮", name: region };
}
