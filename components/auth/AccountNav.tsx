"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { fetchMe, invalidateMe, type Me } from "@/lib/client-auth";

export default function AccountNav() {
  const router = useRouter();
  const [me, setMe] = useState<Me>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetchMe().then(setMe).finally(() => setLoaded(true));
  }, []);

  const [logoutError, setLogoutError] = useState("");

  async function logout() {
    setLogoutError("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      // If the server did not end the session, do NOT pretend the user is signed out.
      if (!response.ok) throw new Error("LOGOUT_FAILED");
    } catch {
      setLogoutError("تعذّر تسجيل الخروج. حاول مجددًا.");
      return;
    }
    invalidateMe();
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
      {logoutError && <small role="alert" className="muted">{logoutError}</small>}
    </div>
  );
}
