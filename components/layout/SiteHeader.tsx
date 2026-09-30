"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import LanguageSwitcher from "@/components/ui/LanguageSwitcher";

type Me = {
  username?: string | null;
  email?: string | null;
  role?: string | null;
} | null;

const NAV_LINKS = [
  { href: "/ai", label: "GameVortex AI", icon: GameIcon },
  { href: "/games", label: "Games", icon: GameIcon },
  { href: "/apps", label: "Apps", icon: GridIcon },
  { href: "/vip", label: "VIP", icon: CrownIcon },
  { href: "/marketplace", label: "Store", icon: StoreIcon },
  { href: "/api-access", label: "Developer API", icon: ShieldIcon },
  { href: "/support", label: "Support", icon: ShieldIcon },
  { href: "/library", label: "Library", icon: LibraryIcon },
  { href: "/wallet", label: "Wallet", icon: WalletIcon },
  { href: "/gift-cards", label: "Gift Cards", icon: GiftCardIcon },
  { href: "/rewards", label: "Rewards", icon: GiftIcon },
  { href: "/draws", label: "Draws", icon: DrawsIcon },
  { href: "/referrals", label: "Referrals", icon: UsersIcon },
  { href: "/rankings", label: "Rank", icon: TrophyIcon },
  { href: "/quran", label: "Quran", icon: BookIcon },
  { href: "/profile/gamer", label: "Profile", icon: UserIcon },
];

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function GameIcon() {
  return (
    <Icon>
      <rect x="3" y="7" width="18" height="11" rx="4" />
      <path d="M7 11v4M5 13h4" />
      <path d="M16 12h.01M19 14h.01" />
    </Icon>
  );
}

function GridIcon() {
  return (
    <Icon>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </Icon>
  );
}

function CrownIcon() {
  return (
    <Icon>
      <path d="m4 8 3 3 5-7 5 7 3-3-2 11H6L4 8Z" />
      <path d="M6 19h12" />
      <path d="M8 15h8" />
    </Icon>
  );
}


function StoreIcon() {
  return (
    <Icon>
      <path d="M4 10h16" />
      <path d="M5 10v9h14v-9" />
      <path d="M3 10l2-6h14l2 6" />
      <path d="M8 19v-5h8v5" />
    </Icon>
  );
}

function LibraryIcon() {
  return (
    <Icon>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </Icon>
  );
}

function WalletIcon() {
  return (
    <Icon>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18M16 14h2" />
    </Icon>
  );
}

function GiftIcon() {
  return (
    <Icon>
      <rect x="4" y="9" width="16" height="11" rx="2" />
      <path d="M3 9h18v4H3z" />
      <path d="M12 9v11" />
      <path d="M12 9H8.5a2.5 2.5 0 1 1 2.5-2.5V9Z" />
      <path d="M12 9h3.5a2.5 2.5 0 1 0-2.5-2.5V9Z" />
    </Icon>
  );
}

function GiftCardIcon() {
  return (
    <Icon>
      <rect x="3" y="6" width="18" height="12" rx="2.5" />
      <path d="M3 10h18" />
      <path d="M7 15h4" />
    </Icon>
  );
}

function DrawsIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l3 2" />
    </Icon>
  );
}

function UsersIcon() {
  return (
    <Icon>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 19c0-3 2.5-5 6-5s6 2 6 5" />
      <path d="M16 11a3 3 0 1 0-1-5.7" />
      <path d="M17 14c2.4.5 4 2.2 4 5" />
    </Icon>
  );
}

function TrophyIcon() {
  return (
    <Icon>
      <path d="M8 4h8v4a4 4 0 0 1-8 0V4Z" />
      <path d="M8 6H5a3 3 0 0 0 3 3" />
      <path d="M16 6h3a3 3 0 0 1-3 3" />
      <path d="M12 12v5" />
      <path d="M8 21h8" />
      <path d="M9 17h6" />
    </Icon>
  );
}

function BookIcon() {
  return (
    <Icon>
      <path d="M5 4h6v16H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
      <path d="M19 4h-6v16h6a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Z" />
    </Icon>
  );
}

function UserIcon() {
  return (
    <Icon>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c.7-3.3 3.1-5 7-5s6.3 1.7 7 5" />
    </Icon>
  );
}

function ShieldIcon() {
  return (
    <Icon>
      <path d="M12 3 20 6v5c0 5-3.2 8.5-8 10-4.8-1.5-8-5-8-10V6l8-3Z" />
      <path d="m9 12 2 2 4-4" />
    </Icon>
  );
}

function HomeIcon() {
  return (
    <Icon>
      <path d="m3 11 9-8 9 8" />
      <path d="M5 10v10h14V10" />
    </Icon>
  );
}

function MenuIcon() {
  return (
    <Icon>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Icon>
  );
}

function CloseIcon() {
  return (
    <Icon>
      <path d="m6 6 12 12M18 6 6 18" />
    </Icon>
  );
}

function SearchIcon() {
  return (
    <Icon>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </Icon>
  );
}

function BellIcon() {
  return (
    <Icon>
      <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M10 21h4" />
    </Icon>
  );
}

function LogoMark() {
  return (
    <svg viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="gvLogo" x1="6" y1="6" x2="42" y2="42">
          <stop stopColor="#A855F7" />
          <stop offset="1" stopColor="#7C3AED" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="20" stroke="url(#gvLogo)" strokeWidth="3.5" strokeDasharray="90 36" strokeLinecap="round" />
      <circle cx="24" cy="24" r="12" stroke="url(#gvLogo)" strokeWidth="3" strokeDasharray="48 28" strokeLinecap="round" />
      <circle cx="24" cy="24" r="4.5" fill="#F4C95D" />
    </svg>
  );
}

export default function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();

  const [isOpen, setIsOpen] = useState(false);
  const [me, setMe] = useState<Me>(null);
  const [language, setLanguage] = useState<"ar" | "en">("ar");

  useEffect(() => {
    const applyLanguage = () => setLanguage(localStorage.getItem("selectedLanguage") === "en" ? "en" : "ar");
    applyLanguage();
    window.addEventListener("gv-language-change", applyLanguage);
    return () => window.removeEventListener("gv-language-change", applyLanguage);
  }, []);

  useEffect(() => {
    fetch("/api/auth/me", {
      cache: "no-store",
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setMe(data))
      .catch(() => setMe(null));
  }, [pathname]);

  useEffect(() => {
    setIsOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  useEffect(() => {
    document.body.style.overflow = isOpen ? "hidden" : "";

    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {}
    setMe(null);
    setIsOpen(false);
    router.push("/");
    router.refresh();
  }

  const isOwner = me?.role === "SUPER_ADMIN";

  const isActive = (href: string) => {
    if (href === "/") {
      return pathname === "/";
    }

    return (
      pathname === href ||
      pathname.startsWith(`${href}/`)
    );
  };

  const profileHref = "/profile/gamer";
  const translateNav = (label: string) => language === "ar"
    ? ({ Games: "الألعاب", Apps: "التطبيقات", VIP: "VIP", Store: "المتجر", Library: "المكتبة", Wallet: "المحفظة", "Gift Cards": "بطاقات الهدايا", Rewards: "المكافآت", Draws: "السحوبات", Referrals: "الإحالات", Rank: "الترتيب", Quran: "القرآن", Profile: "الملف الشخصي", "GameVortex AI": "GameVortex AI", "الإدارة": "الإدارة" } as Record<string, string>)[label] || label
    : ({ "GameVortex AI": "GameVortex AI", "الإدارة": "Admin" } as Record<string, string>)[label] || label;

  const publicNavLinks = isOwner
    ? [
        ...NAV_LINKS,
        {
          href: "/admin",
          label: "الإدارة",
          icon: ShieldIcon,
        },
      ]
    : NAV_LINKS;

  const desktopNavLinks = [
    { href: "/", label: language === "ar" ? "الرئيسية" : "Home", icon: HomeIcon },
    { href: "/games", label: language === "ar" ? "الألعاب" : "Games", icon: GameIcon },
    { href: "/apps", label: language === "ar" ? "التطبيقات" : "Apps", icon: GridIcon },
    { href: "/marketplace", label: language === "ar" ? "المتجر" : "Marketplace", icon: StoreIcon },
    { href: "/vip", label: "VIP", icon: CrownIcon },
    { href: "/ai", label: "AI", icon: GameIcon },
  ];

  const [searchText, setSearchText] = useState("");
  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const q = searchText.trim();
    router.push(q ? `/games?q=${encodeURIComponent(q)}` : "/games");
  };

  return (
    <>
      <header className="gv-header">
        <div className="gv-header-inner">
          <button
            type="button"
            className="gv-menu-button"
            aria-label="فتح القائمة"
            aria-expanded={isOpen}
            onClick={() => setIsOpen(true)}
          >
            <MenuIcon />
          </button>

          <Link
            href="/"
            className="gv-brand"
            aria-label="GameVortex Hub"
          >
            <span className="gv-brand-mark"><LogoMark /></span><span className="gv-brand-name">GameVortex</span>
          </Link>

          <nav
            className="gv-desktop-nav"
            aria-label="التنقل الرئيسي"
          >
            {desktopNavLinks.map((link) => {
              const IconComponent = link.icon;

              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`gv-nav-link ${
                    isActive(link.href)
                      ? "is-active"
                      : ""
                  }`}
                >
                  <IconComponent />
                  <span>{link.label}</span>
                </Link>
              );
            })}
            <button type="button" className="gv-nav-link" onClick={() => setIsOpen(true)}>
              <span>{language === "ar" ? "المزيد ▾" : "More ▾"}</span>
            </button>
          </nav>

          <form className="gv-search" role="search" onSubmit={submitSearch}>
            <input
              type="search"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder={language === "ar" ? "ابحث عن ألعاب، تطبيقات، أو أي شيء..." : "Search games, apps, or anything..."}
              aria-label={language === "ar" ? "بحث" : "Search"}
            />
            <button type="submit" aria-label={language === "ar" ? "بحث" : "Search"}><SearchIcon /></button>
          </form>

          <div className="gv-header-actions">
            <LanguageSwitcher />
            <Link
              href="/games"
              className="gv-icon-button gv-search-mobile"
              aria-label="البحث عن الألعاب"
            >
              <SearchIcon />
            </Link>

            <Link
              href={profileHref}
              className="gv-icon-button gv-notification-button"
              aria-label="الإشعارات والحساب"
            >
              <BellIcon />
              <span className="gv-notification-dot" />
            </Link>

            <Link
              href={profileHref}
              className="gv-profile-button"
              aria-label="حسابي"
            >
              <span className="gv-profile-avatar">
                {me?.username
                  ?.trim()
                  ?.charAt(0)
                  ?.toUpperCase() || "G"}
              </span>

              <span className="gv-profile-label">
                حسابي
              </span>
            </Link>

            {me ? (
              <button
                type="button"
                className="gv-logout-button"
                onClick={handleLogout}
              >
                {language === "ar" ? "خروج" : "Sign out"}
              </button>
            ) : (
              <>
                <Link href="/auth/login" className="gv-auth-login">{language === "ar" ? "تسجيل الدخول" : "Login"}</Link>
                <Link href="/auth/register" className="gv-auth-signup">{language === "ar" ? "إنشاء حساب" : "Sign Up"}</Link>
              </>
            )}
          </div>
        </div>

        <nav className="gv-mobile-tabs" aria-label={language === "ar" ? "التنقل" : "Sections"}>
          {desktopNavLinks.map((link) => (
            <Link key={link.href} href={link.href} className={isActive(link.href) ? "is-active" : ""}>
              {link.label}
            </Link>
          ))}
        </nav>
      </header>

      <div
        className={`gv-drawer-overlay ${
          isOpen ? "is-visible" : ""
        }`}
        onClick={() => setIsOpen(false)}
        aria-hidden="true"
      />

      <aside
        className={`gv-drawer ${
          isOpen ? "is-open" : ""
        }`}
        role="dialog"
        aria-modal="true"
        aria-label={language === "ar" ? "القائمة الرئيسية" : "Main menu"}
      >
        <div className="gv-drawer-top">
          <Link
            href="/"
            className="gv-brand gv-drawer-brand"
            onClick={() => setIsOpen(false)}
          >
            <span className="gv-brand-mark"><LogoMark /></span><span className="gv-brand-name">GameVortex</span>
          </Link>

          <button
            type="button"
            className="gv-close-button"
            aria-label={language === "ar" ? "إغلاق القائمة" : "Close menu"}
            onClick={() => setIsOpen(false)}
          >
            <CloseIcon />
          </button>
        </div>

        <div className="gv-drawer-welcome">
          <span className="gv-drawer-kicker">
            GAMEVORTEX HUB
          </span>

          <strong>{language === "ar" ? "عالم الألعاب بين يديك" : "Gaming at your fingertips"}</strong>

          <span>
            {language === "ar" ? "اكتشف، العب، اجمع، وارتقِ بتجربتك." : "Discover, play, collect and level up."}
          </span>
        </div>

        <nav
          className="gv-drawer-nav"
          aria-label={language === "ar" ? "قائمة الهاتف" : "Mobile navigation"}
        >
          <Link
            href="/"
            className={`gv-drawer-link ${
              isActive("/") ? "is-active" : ""
            }`}
            onClick={() => setIsOpen(false)}
          >
            <span className="gv-drawer-icon">
              <HomeIcon />
            </span>

            <span>{language === "ar" ? "الرئيسية" : "Home"}</span>
          </Link>

          {publicNavLinks.map((link) => {
            const IconComponent = link.icon;

            return (
              <Link
                key={link.href}
                href={link.href}
                className={`gv-drawer-link ${
                  isActive(link.href)
                    ? "is-active"
                    : ""
                }`}
                onClick={() => setIsOpen(false)}
              >
                <span className="gv-drawer-icon">
                  <IconComponent />
                </span>

                <span>{translateNav(link.label)}</span>
              </Link>
            );
          })}
        </nav>

        {me ? (
          <button
            type="button"
            className="gv-drawer-logout"
            onClick={handleLogout}
          >
            {language === "ar" ? "تسجيل الخروج" : "Sign out"}
          </button>
        ) : (
          <Link
            href="/auth/login"
            className="gv-drawer-logout gv-drawer-login"
            onClick={() => setIsOpen(false)}
          >
            {language === "ar" ? "تسجيل الدخول" : "Sign in"}
          </Link>
        )}
      </aside>
    </>
  );
}
