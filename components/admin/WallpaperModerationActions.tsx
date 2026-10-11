"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../../app/admin/admin.module.css";
import { NETWORK_ERROR_MESSAGE, readAdminError } from "@/lib/admin-client";

type Decision = "APPROVED" | "REJECTED";

/**
 * Approve / reject buttons for one pending wallpaper.
 *
 * Replaces an inline <script> + empty <form> that lived in the page: that
 * script had no error text (only alert()), no per-button busy state and could
 * double-submit. This version disables both buttons while a request runs,
 * confirms a rejection, shows the real error under the buttons and refreshes
 * the server list on success.
 */
export default function WallpaperModerationActions({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<Decision | null>(null);
  const [error, setError] = useState("");

  async function decide(decision: Decision) {
    if (busy) return;

    if (
      decision === "REJECTED" &&
      !window.confirm("رفض هذه الخلفية وإخفاءها عن العامة؟")
    ) {
      return;
    }

    setBusy(decision);
    setError("");

    try {
      const response = await fetch("/api/admin/wallpapers/moderation", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, decision }),
      });

      if (!response.ok) {
        setError(await readAdminError(response));
        return;
      }

      router.refresh();
    } catch {
      setError(NETWORK_ERROR_MESSAGE);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn"
          disabled={busy !== null}
          onClick={() => void decide("APPROVED")}
        >
          {busy === "APPROVED" ? "جارٍ القبول..." : "قبول ومكافأة المساهم بالنقاط"}
        </button>

        <button
          type="button"
          className="btn secondary"
          disabled={busy !== null}
          onClick={() => void decide("REJECTED")}
        >
          {busy === "REJECTED" ? "جارٍ الرفض..." : "رفض"}
        </button>
      </div>

      {error ? (
        <p role="alert" className={styles.inlineError}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
