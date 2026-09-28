"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "../../app/auth/auth.module.css";
import { useLocale } from "@/components/ui/useLocale";

type Provider = "google" | "apple" | "steam";
type Availability = Record<Provider, boolean>;

const definitions: Array<{ id: Provider; label: string; icon: React.ReactNode }> = [
  { id: "google", label: "Google", icon: <svg width="19" height="19" viewBox="0 0 24 24" aria-hidden="true"><path fill="#ff5840" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.91 3.27-4.73 3.27-8.1Z"/><path fill="#972bb8" d="M12 23c2.97 0 5.46-.99 7.28-2.65l-3.57-2.77c-.99.66-2.25 1.06-3.71 1.06-2.86 0-5.28-1.93-6.15-4.53H2.16v2.84A11 11 0 0 0 12 23Z"/><path fill="#09c3ff" d="M5.85 14.11A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.35-2.11V7.05H2.16A11 11 0 0 0 1 12c0 1.78.43 3.46 1.16 4.95l3.69-2.84Z"/><path fill="#2dfaa4" d="M12 5.36c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1a11 11 0 0 0-9.84 6.05l3.69 2.84C6.72 7.29 9.14 5.36 12 5.36Z"/></svg> },
  { id: "apple", label: "Apple", icon: <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.37 12.07c.02 2.15 1.89 2.86 1.91 2.87-.02.05-.3 1.03-.99 2.04-.6.88-1.23 1.76-2.22 1.78-.97.02-1.29-.57-2.4-.57s-1.47.55-2.4.59c-.96.04-1.7-.95-2.3-1.82-1.25-1.8-2.2-5.08-.92-7.3.64-1.1 1.78-1.8 3.02-1.82.94-.02 1.82.63 2.4.63.57 0 1.64-.78 2.77-.67.47.02 1.8.19 2.65 1.44-.07.05-1.58.92-1.56 2.83ZM14.55 5.48c.5-.6.84-1.43.75-2.26-.73.03-1.61.49-2.13 1.09-.47.53-.88 1.38-.77 2.19.81.06 1.65-.42 2.15-1.02Z"/></svg> },
  { id: "steam", label: "Steam", icon: <svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-9.95 9.06l5.36 2.22a2.8 2.8 0 0 1 1.6-.5l2.38-3.45v-.05a3.7 3.7 0 1 1 3.7 3.7h-.08l-3.4 2.43a2.8 2.8 0 0 1-5.55.63L2.2 14.4A10 10 0 1 0 12 2zM7.9 17.7a2.1 2.1 0 0 0 4.1-.75l-1.8-.75a2.1 2.1 0 0 0-2.3 1.5zm7.7-6a2.47 2.47 0 1 0 0-4.94 2.47 2.47 0 0 0 0 4.94z"/></svg> },
];

export default function SocialLoginRow() {
  const english = useLocale() === "en";
  const [availability, setAvailability] = useState<Availability>({ google: false, apple: false, steam: false });
  useEffect(() => {
    let live = true;
    fetch("/api/auth/oauth/providers", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((result) => {
      if (live && result?.data) setAvailability(result.data);
    }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  const active = definitions.filter(({ id }) => availability[id]);
  if (!active.length) return null;
  return <>
    <div className={styles.divider}>{english ? "Or continue with" : "أو تابع باستخدام"}</div>
    <div className={styles.socialRow}>
      {active.map(({ id, label, icon }) => <Link key={id} className={styles.socialBtn} href={`/api/auth/oauth/${id}`} aria-label={english ? `Continue with ${label}` : `تسجيل الدخول باستخدام ${label}`}>
        {icon}<span>{label}</span>
      </Link>)}
    </div>
  </>;
}
