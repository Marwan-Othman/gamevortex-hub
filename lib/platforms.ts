export const GAME_PLATFORMS = [
  {
    slug: "pc",
    nameAr: "الكمبيوتر",
    nameEn: "PC",
    icon: "🖥️",
  },
  {
    slug: "playstation",
    nameAr: "بلايستيشن",
    nameEn: "PlayStation",
    icon: "🎮",
  },
  {
    slug: "xbox",
    nameAr: "إكس بوكس",
    nameEn: "Xbox",
    icon: "🟢",
  },
  {
    slug: "nintendo",
    nameAr: "نينتندو",
    nameEn: "Nintendo",
    icon: "🔴",
  },
  {
    slug: "android",
    nameAr: "أندرويد",
    nameEn: "Android",
    icon: "📱",
  },
  {
    slug: "ios",
    nameAr: "آيفون و iPad",
    nameEn: "iOS",
    icon: "🍎",
  },
  {
    slug: "mac",
    nameAr: "ماك",
    nameEn: "Mac",
    icon: "💻",
  },
  {
    slug: "linux",
    nameAr: "لينكس",
    nameEn: "Linux",
    icon: "🐧",
  },
  {
    slug: "steam-deck",
    nameAr: "Steam Deck",
    nameEn: "Steam Deck",
    icon: "🎮",
  },
  {
    slug: "web",
    nameAr: "المتصفح",
    nameEn: "Web",
    icon: "🌐",
  },
] as const;

export type GamePlatformSlug =
  (typeof GAME_PLATFORMS)[number]["slug"];

export type GamePlatformEnum =
  | "PC"
  | "PLAYSTATION"
  | "XBOX"
  | "NINTENDO"
  | "ANDROID"
  | "IOS"
  | "MAC"
  | "LINUX"
  | "STEAM_DECK"
  | "WEB";

const PLATFORM_ENUM_BY_SLUG: Record<
  GamePlatformSlug,
  GamePlatformEnum
> = {
  pc: "PC",
  playstation: "PLAYSTATION",
  xbox: "XBOX",
  nintendo: "NINTENDO",
  android: "ANDROID",
  ios: "IOS",
  mac: "MAC",
  linux: "LINUX",
  "steam-deck": "STEAM_DECK",
  web: "WEB",
};

const PLATFORM_SLUG_BY_ENUM: Record<
  GamePlatformEnum,
  GamePlatformSlug
> = {
  PC: "pc",
  PLAYSTATION: "playstation",
  XBOX: "xbox",
  NINTENDO: "nintendo",
  ANDROID: "android",
  IOS: "ios",
  MAC: "mac",
  LINUX: "linux",
  STEAM_DECK: "steam-deck",
  WEB: "web",
};

export function getPlatformBySlug(
  slug: string | null | undefined,
) {
  if (!slug) return null;

  const normalized = slug.trim().toLowerCase();

  return (
    GAME_PLATFORMS.find(
      (platform) => platform.slug === normalized,
    ) ?? null
  );
}

export function normalizePlatform(
  value: string | null | undefined,
): GamePlatformSlug | null {
  if (!value) return null;

  const normalized = value.trim().toLowerCase();

  const aliases: Record<
    string,
    GamePlatformSlug
  > = {
    pc: "pc",
    computer: "pc",
    windows: "pc",
    "windows pc": "pc",

    playstation: "playstation",
    ps: "playstation",
    ps4: "playstation",
    ps5: "playstation",
    "playstation 4": "playstation",
    "playstation 5": "playstation",

    xbox: "xbox",
    "xbox one": "xbox",
    "xbox series": "xbox",
    "xbox series x": "xbox",
    "xbox series s": "xbox",

    nintendo: "nintendo",
    switch: "nintendo",
    "nintendo switch": "nintendo",

    android: "android",

    ios: "ios",
    iphone: "ios",
    ipad: "ios",

    mac: "mac",
    macos: "mac",
    "mac os": "mac",

    linux: "linux",

    "steam deck": "steam-deck",
    steamdeck: "steam-deck",

    web: "web",
    browser: "web",
  };

  return aliases[normalized] ?? null;
}

export function getPlatformEnum(
  value: string | null | undefined,
): GamePlatformEnum | null {
  const slug = normalizePlatform(value);

  if (!slug) return null;

  return PLATFORM_ENUM_BY_SLUG[slug];
}

export function getPlatformSlugFromEnum(
  value: string | null | undefined,
): GamePlatformSlug | null {
  if (!value) return null;

  const normalized = value
    .trim()
    .toUpperCase() as GamePlatformEnum;

  return PLATFORM_SLUG_BY_ENUM[normalized] ?? null;
}

export function getPlatformName(
  slug: string | null | undefined,
  locale: "ar" | "en" = "ar",
) {
  const platform = getPlatformBySlug(slug);

  if (!platform) {
    return slug ?? "";
  }

  return locale === "en"
    ? platform.nameEn
    : platform.nameAr;
}
