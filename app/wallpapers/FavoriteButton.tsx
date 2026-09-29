"use client";

import { useState } from "react";

export default function FavoriteButton({ wallpaperId, initialFavorited = false }: { wallpaperId: string; initialFavorited?: boolean }) {
  const [favorited, setFavorited] = useState(initialFavorited);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/wallpapers/${encodeURIComponent(wallpaperId)}/favorite`, { method: "POST" });
      const result = await response.json().catch(() => ({}));
      if (response.status === 401) {
        window.location.href = `/login?next=${encodeURIComponent(`/wallpapers/${wallpaperId}`)}`;
        return;
      }
      if (!response.ok) throw new Error(result.error || "Failed");
      setFavorited(Boolean(result.favorited));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button className="btn secondary" type="button" onClick={toggle} disabled={busy} aria-pressed={favorited}>
      {favorited ? "❤️ محفوظة" : "♡ حفظ"}
    </button>
  );
}
