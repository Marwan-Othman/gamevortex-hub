"use client";

import { useState } from "react";
import { messageFromResponse, NETWORK_ERROR_MESSAGE } from "@/lib/error-messages";

export default function FavoriteButton({ wallpaperId, initialFavorited = false }: { wallpaperId: string; initialFavorited?: boolean }) {
  const [favorited, setFavorited] = useState(initialFavorited);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function toggle() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/wallpapers/${encodeURIComponent(wallpaperId)}/favorite`, { method: "POST" });
      if (response.status === 401) {
        window.location.href = `/auth/login?next=${encodeURIComponent(`/wallpapers/${wallpaperId}`)}`;
        return;
      }
      if (!response.ok) {
        // Previously this threw and nothing caught it: the button just did nothing and the console showed an unhandled rejection.
        setError(await messageFromResponse(response, "تعذّر حفظ الخلفية في المفضلة."));
        return;
      }
      const result = (await response.json().catch(() => ({}))) as { favorited?: unknown };
      setFavorited(Boolean(result.favorited));
    } catch {
      setError(NETWORK_ERROR_MESSAGE);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span>
      <button className="btn secondary" type="button" onClick={toggle} disabled={busy} aria-pressed={favorited}>
        {favorited ? "❤️ محفوظة" : "♡ حفظ"}
      </button>
      {error && <small className="muted" role="alert" style={{ display: "block", marginTop: 6 }}>{error}</small>}
    </span>
  );
}
