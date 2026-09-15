"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import LanguageSwitcher from "@/components/ui/LanguageSwitcher";
import AccountNav from "@/components/auth/AccountNav";

// Same links, same order, same labels as the original layout.tsx nav.
const NAV_LINKS: Array<[string, string]> = [
  ["/games", "الألعاب"],
  ["/marketplace", "المتجر"],
  ["/library", "مكتبتي"],
  ["/rewards", "المكافآت"],
  ["/referrals", "الإحالات"],
  ["/draws", "السحوبات"],
  ["/rankings", "الترتيب"],
  ["/quran", "القرآن"],
  ["/profile/gamer", "ملفي"],
  ["/admin", "الإدارة"],
];

export default function SiteHeader() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close the drawer whenever the route changes (layout.tsx doesn't
  // remount between navigations, so without this the drawer would
  // stay open after tapping a link).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return (
    <header className="site-header">
      <div className="nav-wrap">
        <Link href="/" className="brand">
          <span className="brand-mark"><span>V</span></span>
          <span>GameVortex</span>
        </Link>

        <nav className={open ? "nav-open" : ""} aria-label="التنقل الرئيسي">
          {NAV_LINKS.map(([href, label]) => (
            <Link key={href} href={href}>{label}</Link>
          ))}
        </nav>

        <button
          type="button"
          className={`nav-backdrop${open ? " nav-backdrop-visible" : ""}`}
          aria-hidden="true"
          tabIndex={-1}
          onClick={() => setOpen(false)}
        />

        <div className="nav-side">
          <button
            type="button"
            className="nav-toggle-btn"
            aria-label={open ? "إغلاق القائمة" : "فتح القائمة"}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <span className="nav-toggle-icon" aria-hidden="true" />
          </button>
          <LanguageSwitcher />
          <AccountNav />
        </div>
      </div>
    </header>
  );
}
