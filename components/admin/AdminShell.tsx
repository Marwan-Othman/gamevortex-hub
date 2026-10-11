"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import styles from "../../app/admin/admin.module.css";

/**
 * One navigation source of truth for every /admin/* page.
 *
 * - Every entry points to a page that really exists (no "coming soon"
 *   placeholders for pages that are already built, and no placeholders at all
 *   for sections that have no page yet — they were dead items).
 * - `also` lists extra path prefixes that belong to the same entry, so the
 *   right item is highlighted on nested pages (for example the wallpaper
 *   review screen lives under the moderation entry).
 * - `keywords` feed the "jump to page" search box in the top bar.
 */
type NavItem = {
  label: string;
  href: string;
  icon: React.ReactNode;
  also?: string[];
  keywords?: string;
};

type NavSection = {
  title: string;
  items: NavItem[];
};

const NAV_SECTIONS: NavSection[] = [
  {
    title: "الرئيسية",
    items: [
      { label: "لوحة التحكم", href: "/admin", icon: <IconDashboard />, keywords: "dashboard home إحصائيات تقارير" },
      { label: "مركز المالك", href: "/admin/owner-control", icon: <IconSettings />, keywords: "owner control مالك صلاحيات" },
      { label: "المالية والاسترداد", href: "/admin/control-center", icon: <IconPayments />, keywords: "finance refund wallet محفظة مالية استرداد رصيد طلبات مشتريات سحب" },
    ],
  },
  {
    title: "إدارة المحتوى",
    items: [
      { label: "الألعاب والتطبيقات", href: "/admin/content", icon: <IconGames />, keywords: "games apps ألعاب تطبيقات" },
      { label: "فحص المحتوى", href: "/admin/content-health", icon: <IconSupport />, keywords: "content health تكرار" },
      { label: "Mods", href: "/admin/mods", icon: <IconGames />, keywords: "mods مودات" },
      { label: "الخلفيات", href: "/admin/wallpapers", icon: <IconWallpaper />, keywords: "wallpapers خلفيات" },
      { label: "القرآن", href: "/admin/quran", icon: <IconQuran />, keywords: "quran reciters قراء" },
      {
        label: "المراجعة والإشراف",
        href: "/admin/moderation",
        icon: <IconSupport />,
        also: ["/admin/wallpapers/moderation"],
        keywords: "moderation reports بلاغات مراجعة خلفيات",
      },
    ],
  },
  {
    title: "المتجر والمبيعات",
    items: [
      { label: "المتجر والمنتجات", href: "/admin/store", icon: <IconStore />, keywords: "store products orders keys متجر منتجات مفاتيح طلبات" },
      { label: "البطاقات والهدايا", href: "/admin/gift-cards", icon: <IconCards />, keywords: "gift cards fazercards بطاقات هدايا" },
    ],
  },
  {
    title: "المستخدمون والبرامج",
    items: [
      { label: "المستخدمون", href: "/admin/users", icon: <IconUsers />, keywords: "users roles مستخدمين أدوار" },
      { label: "VIP", href: "/admin/vip", icon: <IconVip />, keywords: "vip subscriptions اشتراكات" },
      { label: "سحوبات الجوائز", href: "/admin/draws", icon: <IconDraws />, keywords: "draws raffle قرعة سحب جوائز" },
      { label: "الدعم الفني", href: "/admin/support", icon: <IconMessages />, keywords: "support tickets دعم تذاكر" },
    ],
  },
  {
    title: "الذكاء والأنظمة",
    items: [
      { label: "الذكاء الاصطناعي", href: "/admin/ai", icon: <IconAI />, keywords: "ai gamevortex ذكاء" },
      { label: "التداول", href: "/admin/trading", icon: <IconReports />, keywords: "trading تداول" },
      { label: "مفاتيح API", href: "/admin/api-keys", icon: <IconKey />, keywords: "api keys مفاتيح" },
      { label: "سجل الأخطاء", href: "/admin/errors", icon: <IconPayments />, keywords: "errors logs أخطاء سجل" },
    ],
  },
  {
    title: "النظام",
    items: [
      { label: "الإعدادات", href: "/admin/settings", icon: <IconSettings />, keywords: "settings إعدادات تكاملات" },
    ],
  },
];

const ALL_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((section) => section.items);

function matchesPath(pathname: string, base: string) {
  return base === "/admin"
    ? pathname === "/admin"
    : pathname === base || pathname.startsWith(`${base}/`);
}

/** The most specific matching entry wins, so only one item is ever active. */
function activeHref(pathname: string) {
  let best: { href: string; length: number } | null = null;

  for (const item of ALL_ITEMS) {
    for (const base of [item.href, ...(item.also ?? [])]) {
      if (matchesPath(pathname, base) && (!best || base.length > best.length)) {
        best = { href: item.href, length: base.length };
      }
    }
  }

  return best?.href ?? null;
}

export default function AdminShell({
  ownerLabel,
  children,
}: {
  ownerLabel: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [query, setQuery] = useState("");

  const initial = ownerLabel.trim().charAt(0).toUpperCase() || "O";
  const current = activeHref(pathname);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    return ALL_ITEMS.filter((item) =>
      `${item.label} ${item.href} ${item.keywords ?? ""}`.toLowerCase().includes(q),
    ).slice(0, 6);
  }, [query]);

  function go(href: string) {
    setQuery("");
    router.push(href);
  }

  function onSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (results[0]) go(results[0].href);
  }

  function renderNavItem(item: NavItem, mobile = false) {
    const active = current === item.href;

    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={
          mobile
            ? `${styles.mobileAdminLink} ${active ? styles.mobileAdminLinkActive : ""}`
            : `${styles.navLink} ${active ? styles.active : ""}`
        }
      >
        {item.icon}

        <span className={mobile ? styles.mobileAdminLinkText : undefined}>
          {item.label}
        </span>
      </Link>
    );
  }

  return (
    <div className={styles.shell}>
      <div className={styles.layout}>
        {/* Desktop sidebar (>= 960px) */}
        <aside className={styles.sidebar}>
          <div className={styles.sidebarBrand}>
            <svg width="26" height="26" viewBox="0 0 40 40" fill="none" aria-hidden="true">
              <path d="M20 3 36 30H4z" stroke="#a78bfa" strokeWidth="2.5" fill="none" />
            </svg>
            GAMEVORTEX HUB
          </div>

          <nav
            aria-label="قائمة إدارة المالك"
            style={{ display: "flex", flexDirection: "column", gap: 6 }}
          >
            {NAV_SECTIONS.map((section) => (
              <div key={section.title}>
                <div
                  style={{
                    fontSize: 10,
                    opacity: 0.55,
                    padding: "12px 12px 5px",
                    fontWeight: 700,
                  }}
                >
                  {section.title}
                </div>

                {section.items.map((item) => renderNavItem(item))}
              </div>
            ))}
          </nav>

          <Link href="/" className={styles.viewSiteBtn}>
            <IconExternal />
            عرض الموقع
          </Link>

          <div className={styles.sidebarFooter}>GameVortex Hub © 2026</div>
        </aside>

        <div className={styles.adminMain}>
          <header className={styles.topbar}>
            <form
              className={styles.searchWrap}
              role="search"
              onSubmit={onSearchSubmit}
            >
              <div className={styles.searchBar}>
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="m21 21-4.3-4.3" />
                </svg>

                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setQuery("");
                  }}
                  placeholder="انتقل إلى صفحة في الإدارة..."
                  aria-label="الانتقال السريع بين صفحات الإدارة"
                  autoComplete="off"
                />
              </div>

              {query.trim() ? (
                <div className={styles.searchResults} role="listbox">
                  {results.length ? (
                    results.map((item) => (
                      <button
                        type="button"
                        role="option"
                        aria-selected={false}
                        key={item.href}
                        className={styles.searchResult}
                        onClick={() => go(item.href)}
                      >
                        {item.icon}
                        <span>{item.label}</span>
                      </button>
                    ))
                  ) : (
                    <div className={styles.searchEmpty}>لا توجد صفحة بهذا الاسم</div>
                  )}
                </div>
              ) : null}
            </form>

            <div className={styles.ownerChip}>
              <span>{ownerLabel}</span>

              <span className={styles.ownerAvatar}>{initial}</span>
            </div>
          </header>

          {/* Mobile navigation: collapsed on inner pages so it never pushes
              the real content down; open on the dashboard. `key` re-mounts it
              on every navigation so the menu closes after you pick a page. */}
          <section className={styles.mobileAdminNav} aria-label="إدارة المنصة">
            <details
              key={pathname}
              className={styles.mobileAdminDetails}
              open={pathname === "/admin"}
            >
              <summary className={styles.mobileAdminHeader}>
                <div>
                  <span className={styles.mobileAdminEyebrow}>GAMEVORTEX HUB</span>

                  <h2>إدارة المنصة</h2>

                  <p>القائمة الكاملة — اضغط للفتح أو الإغلاق</p>
                </div>

                <div className={styles.mobileAdminIcon}>
                  <IconDashboard />
                </div>
              </summary>

              <div className={styles.mobileAdminSections}>
                {NAV_SECTIONS.map((section) => (
                  <div className={styles.mobileAdminSection} key={section.title}>
                    <div className={styles.mobileAdminSectionTitle}>
                      {section.title}
                    </div>

                    <div className={styles.mobileAdminGrid}>
                      {section.items.map((item) => renderNavItem(item, true))}
                    </div>
                  </div>
                ))}
              </div>

              <Link href="/" className={styles.mobileAdminViewSite}>
                <IconExternal />
                <span>عرض الموقع</span>
              </Link>
            </details>
          </section>

          {/* Pages render their own <main>, so this is a plain container. */}
          <div className={styles.content}>{children}</div>
        </div>
      </div>
    </div>
  );
}

function IconDashboard() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  );
}

function IconWallpaper() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8" cy="9" r="1.2" />
      <path d="m4 17 5-5 3 3 2-2 6 5" />
    </svg>
  );
}

function IconGames() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect x="2" y="6" width="20" height="12" rx="4" />
      <path d="M7 10v4M5 12h4M15.5 11.5h.01M18 13.5h.01" />
    </svg>
  );
}


function IconCards() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect x="2" y="6" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
    </svg>
  );
}

function IconUsers() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
      <path d="M18 8v5M15.5 10.5h5" />
    </svg>
  );
}

function IconStore() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M3 9 4 4h16l1 5" />
      <path d="M4 9v10h16V9" />
      <path d="M4 9h16" />
    </svg>
  );
}

function IconOrders() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect x="4" y="4" width="16" height="17" rx="2" />
      <path d="M8 9h8M8 13h8M8 17h5" />
    </svg>
  );
}

function IconPurchases() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="9" cy="20" r="1.3" />
      <circle cx="17" cy="20" r="1.3" />
      <path d="M2 3h2l2.4 12.4a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.6L21 7H6" />
    </svg>
  );
}

function IconReports() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M4 20V10M12 20V4M20 20v-7" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

function IconMessages() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function IconPayments() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
    </svg>
  );
}

function IconSupport() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M12 2 4 5v6c0 5 3.4 9 8 11 4.6-2 8-6 8-11V5z" />
    </svg>
  );
}

function IconDraws() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M20 12v9H4v-9M2 7h20v5H2zM12 7v14" />
      <path d="M12 7c-2 0-3-1.5-3-3s1-3 3-3 3 1.5 3 3-1 3-3 3z" />
    </svg>
  );
}

function IconVip() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="m12 3 2.5 5 5.5.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.5-.8z" />
    </svg>
  );
}

function IconRewards() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v10M8.5 10c0-1.5 1.2-2.5 3.5-2.5s3.5 1 3.5 2.5-1.2 2.5-3.5 2.5-3.5 1-3.5 2.5 1.2 2.5 3.5 2.5 3.5-1 3.5-2.5" />
    </svg>
  );
}

function IconReferrals() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="9" cy="7" r="3" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M3 20c0-3.5 2.5-6 6-6 2.2 0 4 1 5 2.6" />
      <path d="M15 15c2.8 0 5 1.8 5 4" />
    </svg>
  );
}

function IconAI() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="M8 12h8M12 8v8" />
      <circle cx="9" cy="9" r=".7" fill="currentColor" />
      <circle cx="15" cy="15" r=".7" fill="currentColor" />
    </svg>
  );
}

function IconQuran() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M4 4h11a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3z" />
      <path d="M18 4v16" />
    </svg>
  );
}

function IconExternal() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
    >
      <path d="M14 3h7v7M21 3l-9 9M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" />
    </svg>
  );
}

function IconKey() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 9-9M16 7l3 3M14 9l2 2" />
    </svg>
  );
}
