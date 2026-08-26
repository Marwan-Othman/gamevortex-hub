"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Me = { username?: string | null; email: string; role: string } | null;

export default function AccountNav() {
  const router = useRouter();
  const [me, setMe] = useState<Me>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then(setMe)
      .catch(() => setMe(null))
      .finally(() => setLoaded(true));
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setMe(null);
    router.push("/");
    router.refresh();
  }

  if (!loaded) return <span className="account-nav-placeholder" aria-hidden="true" />;

  if (!me) {
    return (
      <div className="account-nav">
        <Link className="btn secondary" href="/auth/login">دخول</Link>
        <Link className="btn" href="/auth/register">تسجيل</Link>
      </div>
    );
  }

  return (
    <div className="account-nav">
      <Link className="btn secondary" href="/profile/gamer">{me.username || me.email}</Link>
      <button className="btn" type="button" onClick={logout}>خروج</button>
    </div>
  );
}
