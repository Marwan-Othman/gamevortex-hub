"use client";
import { useEffect, useMemo, useState } from "react";

type LibraryItem = { id: string; status: "WANT" | "PLAYING" | "BEATEN" | "ARCHIVED"; game: { id: string } };
type RelationItem = { id: string; game: { id: string } };

const statuses = [
  ["WANT", "أريد لعبها"],
  ["PLAYING", "ألعبها"],
  ["BEATEN", "أنهيتها"],
  ["ARCHIVED", "مؤرشفة"],
] as const;

export default function GameActions({ gameId }: { gameId: string }) {
  const [library, setLibrary] = useState<LibraryItem | null>(null);
  const [favorite, setFavorite] = useState(false);
  const [wishlist, setWishlist] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function load() {
    setLoading(true);
    try {
      const [lr, fr, wr] = await Promise.all([
        fetch(`/api/me/games/library?gameId=${encodeURIComponent(gameId)}`, { cache: "no-store" }),
        fetch("/api/me/games/favorites", { cache: "no-store" }),
        fetch("/api/me/games/wishlist", { cache: "no-store" }),
      ]);
      if (lr.status === 401 || fr.status === 401 || wr.status === 401) {
        setMessage("سجّل الدخول لاستخدام المكتبة والمفضلة وقائمة الرغبات.");
        return;
      }
      if (lr.ok) {
        const data = (await lr.json()) as LibraryItem[];
        setLibrary(data[0] ?? null);
      }
      if (fr.ok) {
        const data = (await fr.json()) as RelationItem[];
        setFavorite(data.some((item) => item.game.id === gameId));
      }
      if (wr.ok) {
        const data = (await wr.json()) as RelationItem[];
        setWishlist(data.some((item) => item.game.id === gameId));
      }
    } catch {
      setMessage("تعذر تحميل حالة اللعبة الآن.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [gameId]);

  const statusLabel = useMemo(
    () => statuses.find(([value]) => value === library?.status)?.[1] ?? "إضافة إلى المكتبة",
    [library?.status]
  );

  async function mutate(url: string, options: RequestInit, success: string) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(url, options);
      if (response.status === 401) throw new Error("سجّل الدخول أولًا.");
      if (!response.ok) throw new Error("تعذر تنفيذ العملية.");
      await load();
      setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "حدث خطأ.");
    } finally {
      setBusy(false);
    }
  }

  function setLibraryStatus(status: (typeof statuses)[number][0]) {
    void mutate(
      "/api/me/games/library",
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ gameId, status }) },
      "تم تحديث حالة اللعبة."
    );
  }

  function toggleFavorite() {
    void mutate(
      favorite ? `/api/me/games/favorites?gameId=${encodeURIComponent(gameId)}` : "/api/me/games/favorites",
      favorite ? { method: "DELETE" } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ gameId }) },
      favorite ? "تمت إزالة اللعبة من المفضلة." : "أضيفت اللعبة إلى المفضلة."
    );
  }

  function toggleWishlist() {
    void mutate(
      wishlist ? `/api/me/games/wishlist?gameId=${encodeURIComponent(gameId)}` : "/api/me/games/wishlist",
      wishlist ? { method: "DELETE" } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ gameId }) },
      wishlist ? "تمت إزالة اللعبة من قائمة الرغبات." : "أضيفت اللعبة إلى قائمة الرغبات."
    );
  }

  if (loading) return <div className="game-actions glass card" aria-busy="true"><span className="muted">جاري تحميل خيارات اللعبة…</span></div>;

  return (
    <section className="game-actions glass card" aria-label="إدارة اللعبة">
      <div className="action-row">
        <button className={`btn ${favorite ? "action-active" : "secondary"}`} onClick={toggleFavorite} disabled={busy} aria-pressed={favorite}>
          {favorite ? "♥ في المفضلة" : "♡ إضافة للمفضلة"}
        </button>
        <button className={`btn ${wishlist ? "action-active" : "secondary"}`} onClick={toggleWishlist} disabled={busy} aria-pressed={wishlist}>
          {wishlist ? "✓ في قائمة الرغبات" : "🔖 قائمة الرغبات"}
        </button>
        <label className="status-select">
          <span className="muted">المكتبة</span>
          <select className="input" value={library?.status ?? "WANT"} onChange={(event) => setLibraryStatus(event.target.value as (typeof statuses)[number][0])} disabled={busy} aria-label="حالة اللعبة في المكتبة">
            {!library && <option value="WANT">إضافة إلى المكتبة</option>}
            {statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        {library && <button className="btn secondary" onClick={() => void mutate(`/api/me/games/library?gameId=${encodeURIComponent(gameId)}`, { method: "DELETE" }, "تمت إزالة اللعبة من المكتبة.")} disabled={busy}>إزالة من المكتبة</button>}
      </div>
      {message && <p className="action-message" role="status">{message}</p>}
      <p className="muted action-hint">{library ? `الحالة الحالية: ${statusLabel}` : "اختر حالة لتضيف اللعبة إلى مكتبتك."}</p>
    </section>
  );
}
