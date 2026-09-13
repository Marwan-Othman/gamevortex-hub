"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import styles from "../../app/admin/admin.module.css";

type NavItem = {
  label: string;
  href?: string;
  icon: React.ReactNode;
  soon?: boolean;
};

const NAV: NavItem[] = [
  { label: "الرئيسية", href: "/", icon: <IconHome /> },
  { label: "لوحة التحكم", href: "/admin", icon: <IconDashboard /> },
  { label: "إدارة الألعاب", href: "/admin/games", icon: <IconGames /> },
  { label: "إدارة التطبيقات", icon: <IconApps />, soon: true },
  { label: "إدارة البطاقات", icon: <IconCards />, soon: true },
  { label: "المستخدمون", icon: <IconUsers />, soon: true },
  { label: "إدارة المتجر", icon: <IconStore />, soon: true },
  { label: "الطلبات", icon: <IconOrders />, soon: true },
  { label: "المشتريات", icon: <IconPurchases />, soon: true },
  { label: "الإحصائيات والتقارير", href: "/admin", icon: <IconReports /> },
  { label: "الإعدادات والخيارات", icon: <IconSettings />, soon: true },
  { label: "الرسائل والإشعارات", icon: <IconMessages />, soon: true },
  { label: "المدفوعات وسجل الأخطاء", href: "/admin/errors", icon: <IconPayments /> },
  { label: "المراجعة والمحتوى", href: "/admin/moderation", icon: <IconSupport /> },
];

export default function AdminShell({
  ownerLabel,
  children,
}: {
  ownerLabel: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const initial = ownerLabel.trim().charAt(0).toUpperCase() || "O";

  return (
    <div className={styles.shell}>
      <div className={styles.layout}>
        {open && <div className={styles.overlay} onClick={() => setOpen(false)} />}
        <aside className={`${styles.sidebar} ${open ? styles.open : ""}`}>
          <div className={styles.sidebarBrand}>
            <svg width="26" height="26" viewBox="0 0 40 40" fill="none">
              <path d="M20 3 36 30H4z" stroke="#a78bfa" strokeWidth="2.5" fill="none" />
            </svg>
            GAMEVORTEX HUB
          </div>

          {NAV.map((item) =>
            item.soon || !item.href ? (
              <span key={item.label} className={`${styles.navLink} ${styles.soon}`}>
                {item.icon}
                {item.label}
                <span className={styles.soonBadge}>قريبًا</span>
              </span>
            ) : (
              <Link
                key={item.label}
                href={item.href}
                className={`${styles.navLink} ${pathname === item.href ? styles.active : ""}`}
                onClick={() => setOpen(false)}
              >
                {item.icon}
                {item.label}
              </Link>
            )
          )}

          <Link href="/" className={styles.viewSiteBtn}>
            <IconExternal /> عرض الموقع
          </Link>
          <div className={styles.sidebarFooter}>GameVortex Hub © 2026</div>
        </aside>

        <div>
          <header className={styles.topbar}>
            <button type="button" className={styles.menuBtn} onClick={() => setOpen(true)} aria-label="فتح القائمة">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            </button>
            <div className={styles.searchBar}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
              <input placeholder="ابحث عن لعبة أو تصنيف..." />
            </div>
            <div className={styles.ownerChip}>
              <span>{ownerLabel}</span>
              <span className={styles.ownerAvatar}>{initial}</span>
            </div>
          </header>
          <main className={styles.content}>{children}</main>
        </div>
      </div>
    </div>
  );
}

function IconHome() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m3 11 9-8 9 8" /><path d="M5 10v10h14V10" /></svg>; }
function IconDashboard() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>; }
function IconGames() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="6" width="20" height="12" rx="4" /><path d="M7 10v4M5 12h4M15.5 11.5h.01M18 13.5h.01" /></svg>; }
function IconApps() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>; }
function IconCards() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="6" width="20" height="14" rx="2" /><path d="M2 10h20" /></svg>; }
function IconUsers() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" /><path d="M18 8v5M15.5 10.5h5" /></svg>; }
function IconStore() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9 4 4h16l1 5M4 9v10h16V9M4 9h16" /></svg>; }
function IconOrders() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="4" width="16" height="17" rx="2" /><path d="M8 9h8M8 13h8M8 17h5" /></svg>; }
function IconPurchases() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="20" r="1.3" /><circle cx="17" cy="20" r="1.3" /><path d="M2 3h2l2.4 12.4a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.6L21 7H6" /></svg>; }
function IconReports() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 20V10M12 20V4M20 20v-7" /></svg>; }
function IconSettings() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>; }
function IconMessages() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>; }
function IconPayments() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></svg>; }
function IconSupport() { return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2 4 5v6c0 5 3.4 9 8 11 4.6-2 8-6 8-11V5z" /></svg>; }
function IconExternal() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M14 3h7v7M21 3l-9 9M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" /></svg>; }
