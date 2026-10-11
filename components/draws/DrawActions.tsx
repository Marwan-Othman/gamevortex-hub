"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminErrorMessage, NETWORK_ERROR_MESSAGE } from "@/lib/admin-client";

type Props = { raffleId: string; status: string; entryCount: number };

export default function DrawActions({ raffleId, status, entryCount }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  async function send(body: Record<string, unknown>, confirmText?: string) {
    if (busy) return;
    // Drawing a winner and cancelling cannot be undone, so ask first.
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setMessage(undefined);
    try {
      const response = await fetch(`/api/admin/draws/${encodeURIComponent(raffleId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(adminErrorMessage(data.error, "فشلت العملية. حاول مرة أخرى."));
        return;
      }
      router.refresh();
    } catch {
      setMessage(NETWORK_ERROR_MESSAGE);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="draw-actions">
      {status === "DRAFT" && <button className="btn" type="button" disabled={busy} onClick={() => send({ action: "UPDATE", status: "OPEN" })}>فتح السحب</button>}
      {status === "OPEN" && <button className="btn secondary" type="button" disabled={busy} onClick={() => send({ action: "UPDATE", status: "CANCELLED" }, "إلغاء هذا السحب نهائيًا؟ لا يمكن التراجع.")}>إلغاء</button>}
      {status === "OPEN" && (
        <button className="btn" type="button" disabled={busy || entryCount === 0} onClick={() => send({ action: "DRAW" }, "سحب الفائز الآن؟ لا يمكن التراجع بعد اختيار الفائز.")}>
          سحب الفائز {entryCount === 0 ? "(لا يوجد مشاركون)" : ""}
        </button>
      )}
      {message && <p className="muted" role="alert">{message}</p>}
    </div>
  );
}
