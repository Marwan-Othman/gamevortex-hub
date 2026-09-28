"use client";

import { useState } from "react";

type EnterDrawButtonProps = {
  raffleId: string;
  ticketCost: number;
  userPoints: number;
  alreadyEnteredTickets: number;
};

export default function EnterDrawButton({ raffleId, ticketCost, userPoints, alreadyEnteredTickets }: EnterDrawButtonProps) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [tickets, setTickets] = useState(alreadyEnteredTickets);
  const [points, setPoints] = useState(userPoints);

  const canAfford = points >= ticketCost;

  async function enter() {
    setBusy(true);
    setMessage(undefined);
    try {
      const response = await fetch(`/api/draws/${encodeURIComponent(raffleId)}/enter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tickets: 1 }),
      });
      const data = await response.json() as { entry?: { tickets: number } } & { error?: string };
      if (!response.ok) {
        const messages: Record<string, string> = {
          UNAUTHORIZED: "سجّل الدخول أولًا للمشاركة في السحب.",
          INSUFFICIENT_POINTS: "رصيد النقاط غير كافٍ لشراء تذكرة.",
          DRAW_FULL: "اكتمل عدد التذاكر المتاحة لهذا السحب.",
          DRAW_NOT_OPEN: "هذا السحب غير مفتوح حاليًا.",
          DRAW_CLOSED: "أُغلق باب المشاركة في هذا السحب.",
        };
        setMessage(messages[data.error || ""] || "تعذّر تسجيل تذكرتك. حاول مجددًا.");
        return;
      }
      setTickets(data.entry?.tickets ?? tickets + 1);
      setPoints((current) => current - ticketCost);
      setMessage("تم تسجيل تذكرتك بنجاح!");
    } catch {
      setMessage("تعذر الاتصال بالخادم. تحقق من اتصالك وحاول مجددًا.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button className="btn" type="button" onClick={enter} disabled={busy || !canAfford}>
        {busy ? "جارٍ الدخول…" : ticketCost > 0 ? `ادخل السحب (${ticketCost} نقطة)` : "ادخل السحب مجانًا"}
      </button>
      {tickets > 0 && <p className="muted">لديك {tickets} تذكرة في هذا السحب.</p>}
      {!canAfford && !message && <p className="muted">رصيدك الحالي {points} نقطة — غير كافٍ لهذه التذكرة.</p>}
      {message && <p className="muted" role="status" aria-live="polite">{message}</p>}
    </div>
  );
}
