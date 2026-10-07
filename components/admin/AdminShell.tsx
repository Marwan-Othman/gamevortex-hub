"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "../../app/admin/admin.module.css";

type NavItem = {
  label: string;
  href?: string;
  icon: React.ReactNode;
  soon?: boolean;
};

type NavSection = {
  title: string;
  items: NavItem[];
};

const NAV_SECTIONS: NavSection[] = [
  {
    title: "الرئيسية",
    items: [
      {
        label: "لوحة التحكم",
        href: "/admin",
        icon: <IconDashboard />,
      },
    ],
  },
  {
    title: "إدارة المحتوى",
    items: [
      {
        label: "الألعاب",
        href: "/admin/games",
        icon: <IconGames />,
      },
      {
        label: "Downloader",
        href: "/admin/downloader",
        icon: <IconGames />,
      },
      {
        label: "التطبيقات",
        icon: <IconApps />,
        soon: true,
      },
      {
        label: "الخلفيات",
        href: "/admin/wallpapers",
        icon: <IconWallpaper />,
      },
      {
        label: "Mods",
        href: "/admin/mods",
        icon: <IconGames />,
      },
      {
        label: "مراجعة الخلفيات",
        href: "/admin/wallpapers/moderation",
        icon: <IconSupport />,
      },
      {
        label: "القرآن",
        href: "/admin/quran",
        icon: <IconQuran />,
      },
      {
        label: "المراجعة والمحتوى",
        href: "/admin/moderation",
        icon: <IconSupport />,
      },
    ],
  },
  {
    title: "المتجر والمبيعات",
    items: [
      {
        label: "المتجر",
        href: "/admin/store",
        icon: <IconStore />,
      },
      {
        label: "البطاقات والهدايا",
        icon: <IconCards />,
        soon: true,
      },
      {
        label: "الطلبات",
        icon: <IconOrders />,
        soon: true,
      },
      {
        label: "المشتريات",
        icon: <IconPurchases />,
        soon: true,
      },
    ],
  },
  {
    title: "المستخدمون والبرامج",
    items: [
      {
        label: "المستخدمون",
        icon: <IconUsers />,
        soon: true,
      },
      {
        label: "VIP",
        icon: <IconVip />,
        soon: true,
      },
      {
        label: "المكافآت والنقاط",
        icon: <IconRewards />,
        soon: true,
      },
      {
        label: "الإحالات",
        icon: <IconReferrals />,
        soon: true,
      },
      {
        label: "السحوبات",
        href: "/admin/draws",
        icon: <IconDraws />,
      },
    ],
  },
  {
    title: "الذكاء والأنظمة",
    items: [
      {
        label: "الذكاء الاصطناعي",
        icon: <IconAI />,
        soon: true,
      },
      {
        label: "الإحصائيات والتقارير",
        href: "/admin",
        icon: <IconReports />,
      },
      {
        label: "المدفوعات وسجل الأخطاء",
        href: "/admin/errors",
        icon: <IconPayments />,
      },
    ],
  },
  {
    title: "النظام",
    items: [
      {
        label: "الرسائل والإشعارات",
        icon: <IconMessages />,
        soon: true,
      },
      {
        label: "الإعدادات",
        href: "/admin/settings",
        icon: <IconSettings />,
      },
    ],
  },
];

export default function AdminShell({
  ownerLabel,
  children,
}: {
  ownerLabel: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  const initial =
    ownerLabel.trim().charAt(0).toUpperCase() || "O";

  function isActive(item: NavItem) {
    if (!item.href) return false;

    return item.href === "/admin"
      ? pathname === "/admin"
      : pathname === item.href ||
          pathname.startsWith(`${item.href}/`);
  }

  function renderNavItem(item: NavItem, mobile = false) {
    const active = isActive(item);

    if (item.soon || !item.href) {
      return (
        <span
          key={item.label}
          className={
            mobile
              ? styles.mobileAdminLinkSoon
              : `${styles.navLink} ${styles.soon}`
          }
        >
          {item.icon}

          <span className={mobile ? styles.mobileAdminLinkText : undefined}>
            {item.label}
          </span>

          <span
            className={
              mobile
                ? styles.mobileAdminSoonBadge
                : styles.soonBadge
            }
          >
            قريبًا
          </span>
        </span>
      );
    }

    return (
      <Link
        key={item.label}
        href={item.href}
        className={
          mobile
            ? `${styles.mobileAdminLink} ${
                active ? styles.mobileAdminLinkActive : ""
              }`
            : `${styles.navLink} ${
                active ? styles.active : ""
              }`
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

        {/* =====================================================
            DESKTOP SIDEBAR
            يظهر فقط على الشاشات الكبيرة
           ===================================================== */}

        <aside className={styles.sidebar}>
          <div className={styles.sidebarBrand}>
            <svg
              width="26"
              height="26"
              viewBox="0 0 40 40"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M20 3 36 30H4z"
                stroke="#a78bfa"
                strokeWidth="2.5"
                fill="none"
              />
            </svg>

            GAMEVORTEX HUB
          </div>

          <nav
            aria-label="قائمة إدارة المالك"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
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

                {section.items.map((item) =>
                  renderNavItem(item)
                )}
              </div>
            ))}
          </nav>

          <Link
            href="/"
            className={styles.viewSiteBtn}
          >
            <IconExternal />
            عرض الموقع
          </Link>

          <div className={styles.sidebarFooter}>
            GameVortex Hub © 2026
          </div>
        </aside>

        {/* =====================================================
            MAIN AREA
           ===================================================== */}

        <div className={styles.adminMain}>

          <header className={styles.topbar}>
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
                placeholder="ابحث عن لعبة أو منتج أو مستخدم..."
                aria-label="البحث في لوحة الإدارة"
              />
            </div>

            <div className={styles.ownerChip}>
              <span>{ownerLabel}</span>

              <span className={styles.ownerAvatar}>
                {initial}
              </span>
            </div>
          </header>

          {/* ===================================================
              MOBILE ADMIN NAVIGATION
              لا Sidebar على الهاتف
             =================================================== */}

          <section
            className={styles.mobileAdminNav}
            aria-label="إدارة المنصة"
          >
            <div className={styles.mobileAdminHeader}>
              <div>
                <span className={styles.mobileAdminEyebrow}>
                  GAMEVORTEX HUB
                </span>

                <h2>إدارة المنصة</h2>

                <p>
                  جميع أدوات لوحة المالك في مكان واحد
                </p>
              </div>

              <div className={styles.mobileAdminIcon}>
                <IconDashboard />
              </div>
            </div>

            <div className={styles.mobileAdminSections}>
              {NAV_SECTIONS.map((section) => (
                <div
                  className={styles.mobileAdminSection}
                  key={section.title}
                >
                  <div className={styles.mobileAdminSectionTitle}>
                    {section.title}
                  </div>

                  <div className={styles.mobileAdminGrid}>
                    {section.items.map((item) =>
                      renderNavItem(item, true)
                    )}
                  </div>
                </div>
              ))}
            </div>

            <Link
              href="/"
              className={styles.mobileAdminViewSite}
            >
              <IconExternal />
              <span>عرض الموقع</span>
            </Link>
          </section>

          <main className={styles.content}>
            {children}
          </main>
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

function IconApps() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
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
