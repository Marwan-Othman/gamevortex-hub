"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { messageFromResponse, NETWORK_ERROR_MESSAGE } from "@/lib/error-messages";

type FeedItem = {
  id: string;
  type?: string | null;
  message?: string | null;
  createdAt: string;
  user?: { username?: string | null } | null;
  game?: { titleAr?: string | null } | null;
};

type FeedState =
  | { kind: "loading" }
  | { kind: "ready"; items: FeedItem[] }
  | { kind: "login" }
  | { kind: "error"; message: string };

export default function SocialPage() {
  const [state, setState] = useState<FeedState>({ kind: "loading" });

  const load = useCallback(async (signal?: AbortSignal) => {
    setState({ kind: "loading" });
    try {
      const response = await fetch("/api/me/feed", { cache: "no-store", signal });
      if (response.status === 401) {
        setState({ kind: "login" });
        return;
      }
      if (!response.ok) {
        // A failed request is an ERROR state, not an empty feed.
        setState({ kind: "error", message: await messageFromResponse(response, "تعذّر تحميل النشاط الآن.") });
        return;
      }
      const data: unknown = await response.json().catch(() => null);
      setState({ kind: "ready", items: Array.isArray(data) ? (data as FeedItem[]) : [] });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setState({ kind: "error", message: NETWORK_ERROR_MESSAGE });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return (
    <main className="wrap">
      <section className="glass hero">
        <div>
          <p className="muted">VORTEX COMMUNITY</p>
          <h1>Activity Feed</h1>
          <p>تابع نشاطك ونشاط اللاعبين الذين تتابعهم.</p>
        </div>
        <div className="orb">👥</div>
      </section>

      <section className="glass card" aria-live="polite" aria-busy={state.kind === "loading"}>
        {state.kind === "loading" && <p className="muted">جارٍ تحميل النشاط…</p>}

        {state.kind === "login" && (
          <>
            <p>سجّل الدخول لمشاهدة نشاطك ونشاط من تتابعهم.</p>
            <Link className="btn" href="/auth/login?next=/social">تسجيل الدخول</Link>
          </>
        )}

        {state.kind === "error" && (
          <div role="alert">
            <p>{state.message}</p>
            <button className="btn" type="button" onClick={() => void load()}>إعادة المحاولة</button>
          </div>
        )}

        {state.kind === "ready" && state.items.length === 0 && (
          <p className="muted">لا يوجد نشاط بعد. ابدأ بإضافة ألعاب إلى مكتبتك.</p>
        )}

        {state.kind === "ready" && state.items.length > 0 && (
          <div className="grid">
            {state.items.map((item) => (
              <article className="glass card" key={item.id}>
                <strong>@{item.user?.username || "gamer"}</strong>
                <p>{item.message || item.type}</p>
                {item.game?.titleAr && <p className="muted">🎮 {item.game.titleAr}</p>}
                <small className="muted">{new Date(item.createdAt).toLocaleString("ar")}</small>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
