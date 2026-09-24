"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CreateDrawForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [prize, setPrize] = useState("");
  const [description, setDescription] = useState("");
  const [ticketCost, setTicketCost] = useState(50);
  const [maxEntries, setMaxEntries] = useState<string>("");
  const [status, setStatus] = useState<"DRAFT" | "OPEN">("DRAFT");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(undefined);
    try {
      const response = await fetch("/api/admin/draws", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          prize,
          description: description || undefined,
          ticketCost,
          maxEntries: maxEntries ? Number(maxEntries) : undefined,
          status,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(data.error || "تعذّر إنشاء السحب.");
        return;
      }
      setTitle(""); setPrize(""); setDescription(""); setTicketCost(50); setMaxEntries(""); setStatus("DRAFT");
      router.refresh();
    } catch {
      setMessage("تعذر الاتصال بالخادم.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card auth-form" onSubmit={onSubmit}>
      <h2>إنشاء سحب جديد</h2>
      <label htmlFor="draw-title">العنوان</label>
      <input id="draw-title" className="input" required maxLength={140} value={title} onChange={(e) => setTitle(e.target.value)} />
      <label htmlFor="draw-prize">الجائزة</label>
      <input id="draw-prize" className="input" required maxLength={200} value={prize} onChange={(e) => setPrize(e.target.value)} />
      <label htmlFor="draw-description">الوصف (اختياري)</label>
      <textarea id="draw-description" className="input" maxLength={2000} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      <label htmlFor="draw-cost">تكلفة التذكرة (نقاط)</label>
      <input id="draw-cost" className="input" type="number" min={0} max={1000000} value={ticketCost} onChange={(e) => setTicketCost(Number(e.target.value))} />
      <label htmlFor="draw-max">الحد الأقصى للتذاكر (اختياري)</label>
      <input id="draw-max" className="input" type="number" min={1} value={maxEntries} onChange={(e) => setMaxEntries(e.target.value)} placeholder="بلا حد" />
      <label htmlFor="draw-status">الحالة عند الإنشاء</label>
      <select id="draw-status" className="input" value={status} onChange={(e) => setStatus(e.target.value as "DRAFT" | "OPEN")}>
        <option value="DRAFT">مسودة (غير معلن)</option>
        <option value="OPEN">مفتوح مباشرة</option>
      </select>
      {message && <p className="muted" role="alert">{message}</p>}
      <button className="btn" type="submit" disabled={busy}>{busy ? "جارٍ الإنشاء…" : "إنشاء السحب"}</button>
    </form>
  );
}
