"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m3 11 9-8 9 8" />
      <path d="M5 10v10h14V10" />
    </svg>
  );
}

function GameIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="7" width="20" height="11" rx="4" />
      <path d="M7 11v4M5 13h4M16 12h.01M19 14h.01" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function GiftIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="9" width="16" height="11" rx="2" />
      <path d="M3 9h18v4H3z" />
      <path d="M12 9v11" />
      <path d="M12 9H8.5a2.5 2.5 0 1 1 2.5-2.5V9Z" />
      <path d="M12 9h3.5a2.5 2.5 0 1 0-2.5-2.5V9Z" />
    </svg>
  );
}

function CardIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="6" width="18" height="12" rx="2.5" />
      <path d="M3 10h18" />
      <path d="M7 15h4" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.5-7 8-7s8 3 8 7" />
    </svg>
  );
}

function CrownIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m4 8 3 3 5-7 5 7 3-3-2 11H6L4 8Z" />
      <path d="M6 19h12" />
      <path d="M8 15h8" />
    </svg>
  );
}

function AIIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="M9 9h.01M15 9h.01" />
      <path d="M8 14c1.2 1.4 2.8 2 4 2s2.8-.6 4-2" />
      <path d="M12 4V2M12 22v-2M4 12H2M22 12h-2" />
    </svg>
  );
}

const navigationItems = [
  {
    href: "/",
    label: "الرئيسية",
    Icon: HomeIcon,
  },
  {
    href: "/games",
    label: "الألعاب",
    Icon: GameIcon,
  },
  {
    href: "/ai",
    label: "AI",
    Icon: AIIcon,
  },
  {
    href: "/vip",
    label: "VIP",
    Icon: CrownIcon,
  },
  {
    href: "/library",
    label: "المكتبة",
    Icon: GridIcon,
  },
  {
    href: "/rewards",
    label: "المكافآت",
    Icon: GiftIcon,
  },
  {
    href: "/gift-cards",
    label: "البطاقات",
    Icon: CardIcon,
  },
  {
    href: "/profile/gamer",
    label: "حسابي",
    Icon: UserIcon,
  },
];

function isActivePath(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/";
  }

  return (
    pathname === href ||
    pathname.startsWith(`${href}/`)
  );
}

export default function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="gv-bottom-nav"
      aria-label="التنقل الرئيسي"
      style={{
        gridTemplateColumns: `repeat(${navigationItems.length}, 1fr)`,
      }}
    >
      {navigationItems.map(({ href, label, Icon }) => {
        const active = isActivePath(pathname, href);

        return (
          <Link
            key={href}
            href={href}
            className={active ? "active" : ""}
            aria-current={active ? "page" : undefined}
          >
            <Icon />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
