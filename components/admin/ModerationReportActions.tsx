"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../../app/admin/admin.module.css";
import { NETWORK_ERROR_MESSAGE, readAdminError } from "@/lib/admin-client";

type Status = "APPROVED" | "REJECTED" | "HIDDEN";

const LABELS: Record<Status, { idle: string; busy: string }> = {
  APPROVED: { idle: "البلاغ صحيح", busy: "جارٍ الحفظ..." },
  REJECTED: { idle: "رفض البلاغ", busy: "جارٍ الحفظ..." },
  HIDDEN: { idle: "تسجيل الإخفاء", busy: "جارٍ الحفظ..." },
};

/**
 * Resolve one content report. The moderation page used to list reports with
 * no way to act on them even though PATCH /api/admin/moderation already
 * existed, so the queue could never be emptied from the UI.
 *
 * Note: the API records the decision (report status + ModerationAction row)
 * and removes the report from the pending queue. It does not delete or hide
 * the reported content by itself — that stays a deliberate manual step.
 */
export default function ModerationReportActions({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<Status | null>(null);
  const [error, setError] = useState("");

  async function resolve(status: Status) {
    if (busy) return;

    setBusy(status);
    setError("");

    try {
      const response = await fetch("/api/admin/moderation", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reportId,
          status,
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
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
      <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
        <span className="muted">ملاحظة القرار (اختيارية)</span>
        <textarea
          className="input"
          rows={2}
          maxLength={1000}
          value={note}
          disabled={busy !== null}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {(Object.keys(LABELS) as Status[]).map((status) => (
          <button
            key={status}
            type="button"
            className={status === "APPROVED" ? "btn" : "btn secondary"}
            disabled={busy !== null}
            onClick={() => void resolve(status)}
          >
            {busy === status ? LABELS[status].busy : LABELS[status].idle}
          </button>
        ))}
      </div>

      {error ? (
        <p role="alert" className={styles.inlineError}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
