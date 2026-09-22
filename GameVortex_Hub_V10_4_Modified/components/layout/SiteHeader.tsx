"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type Me = {
  username?: string | null;
  email?: string | null;
  role?: string | null;
} | null;

const NAV_LINKS = [
  { href: "/games", label: "الألعاب", icon: GameIcon },
  { href: "/vip", label: "VIP", icon: CrownIcon },
  { href: "/ai", label: "AI", icon: AIIcon },
  { href: "/marketplace", label: "المتجر", icon: StoreIcon },
  { href: "/library", label: "مكتبتي", icon: LibraryIcon },
  { href: "/rewards", label: "المكافآت", icon: GiftIcon },
  { href: "/referrals", label: "الإحالات", icon: UsersIcon },
  { href: "/rankings", label: "الترتيب", icon: TrophyIcon },
  { href: "/quran", label: "القرآن", icon: BookIcon },
  { href: "/profile/gamer", label: "ملفي", icon: UserIcon },
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

function CrownIcon() {
  return (
    <Icon>
      <path d="m4 8 3 3 5-7 5 7 3-3-2 11H6L4 8Z" />
      <path d="M6 19h12" />
      <path d="M8 15h8" />
    </Icon>
  );
}

function AIIcon() {
  return (
    <Icon>
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="M9 9h.01M15 9h.01" />
      <path d="M8 14c1.2 1.4 2.8 2 4 2s2.8-.6 4-2" />
      <path d="M12 4V2M12 22v-2M4 12H2M22 12h-2" />
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

export default function SiteHeader() {
  const pathname = usePathname();

  const [isOpen, setIsOpen] = useState(false);
  const [me, setMe] = useState<Me>(null);

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
            <span className="gv-brand-mark">
              <span>GV</span>
            </span>

            <span className="gv-brand-text">
              <strong>GAMEVORTEX</strong>
              <small>HUB</small>
            </span>
          </Link>

          <nav
            className="gv-desktop-nav"
            aria-label="التنقل الرئيسي"
          >
            <Link
              href="/"
              className={`gv-nav-link ${
                isActive("/") ? "is-active" : ""
              }`}
            >
              <HomeIcon />
              <span>الرئيسية</span>
            </Link>

            {publicNavLinks.map((link) => {
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
          </nav>

          <div className="gv-header-actions">
            <Link
              href="/games"
              className="gv-icon-button"
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
          </div>
        </div>
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
        aria-label="القائمة الرئيسية"
      >
        <div className="gv-drawer-top">
          <Link
            href="/"
            className="gv-brand gv-drawer-brand"
            onClick={() => setIsOpen(false)}
          >
            <span className="gv-brand-mark">
              <span>GV</span>
            </span>

            <span className="gv-brand-text">
              <strong>GAMEVORTEX</strong>
              <small>HUB</small>
            </span>
          </Link>

          <button
            type="button"
            className="gv-close-button"
            aria-label="إغلاق القائمة"
            onClick={() => setIsOpen(false)}
          >
            <CloseIcon />
          </button>
        </div>

        <div className="gv-drawer-welcome">
          <span className="gv-drawer-kicker">
            GAMEVORTEX HUB
          </span>

          <strong>عالم الألعاب بين يديك</strong>

          <span>
            اكتشف، العب، اجمع، وارتقِ بتجربتك.
          </span>
        </div>

        <nav
          className="gv-drawer-nav"
          aria-label="قائمة الهاتف"
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

            <span>الرئيسية</span>
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

                <span>{link.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
