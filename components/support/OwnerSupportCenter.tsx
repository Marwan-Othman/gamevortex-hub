"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { NETWORK_ERROR_MESSAGE, readAdminError } from "@/lib/admin-client";

type Ticket = { id: string; subject: string; status: string; requester: { email: string; username: string | null } };
type Message = { id: string; authorRole: string; body: string; createdAt: string };
type Detail = Ticket & { messages: Message[] };

const STATUS_LABELS: Record<string, string> = {
  OPEN: "مفتوحة",
  IN_PROGRESS: "قيد المعالجة",
  WAITING_USER: "بانتظار المستخدم",
  RESOLVED: "تم الحل",
  CLOSED: "مغلقة",
};

const statuses = Object.keys(STATUS_LABELS);

const ERROR_FALLBACKS: Record<string, string> = {
  TICKET_NOT_FOUND: "التذكرة غير موجودة.",
  TICKET_CLOSED: "التذكرة مغلقة ولا يمكن الرد عليها.",
  INVALID_REQUEST: "الطلب غير صالح.",
};

export default function OwnerSupportCenter() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [active, setActive] = useState<Detail | null>(null);
  const [reply, setReply] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [updating, setUpdating] = useState(false);

  /** One place to turn any failed Response into the visible error line. */
  const fail = useCallback(async (response: Response, fallback: string) => {
    let code: unknown;
    try { code = (await response.clone().json())?.error; } catch { /* not JSON */ }
    setError(typeof code === "string" && ERROR_FALLBACKS[code] ? ERROR_FALLBACKS[code] : await readAdminError(response, fallback));
  }, []);

  const load = useCallback(async () => {
    const response = await fetch("/api/admin/support/tickets", { cache: "no-store" });
    if (!response.ok) { await fail(response, "تعذر تحميل التذاكر."); return false; }
    const result = await response.json();
    setTickets(Array.isArray(result.data) ? result.data : []);
    return true;
  }, [fail]);

  const select = useCallback(async (id: string) => {
    setOpening(id);
    setError("");
    try {
      const response = await fetch(`/api/admin/support/tickets/${encodeURIComponent(id)}`, { cache: "no-store" });
      if (!response.ok) { await fail(response, "تعذر فتح التذكرة."); return; }
      const result = await response.json();
      setActive(result.data);
    } catch {
      setError(NETWORK_ERROR_MESSAGE);
    } finally {
      setOpening(null);
    }
  }, [fail]);

  useEffect(() => {
    void (async () => {
      try { await load(); } catch { setError(NETWORK_ERROR_MESSAGE); } finally { setLoading(false); }
    })();
  }, [load]);

  async function respond(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active || sending || !reply.trim()) return;
    setSending(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/support/tickets/${encodeURIComponent(active.id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: reply }) });
      if (!response.ok) { await fail(response, "تعذر إرسال الرد."); return; }
      setReply("");
      await Promise.all([load(), select(active.id)]);
    } catch {
      setError(NETWORK_ERROR_MESSAGE);
    } finally {
      setSending(false);
    }
  }

  async function changeStatus(status: string) {
    if (!active || updating) return;
    setUpdating(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/support/tickets/${encodeURIComponent(active.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      if (!response.ok) { await fail(response, "تعذر تحديث الحالة."); return; }
      await Promise.all([load(), select(active.id)]);
    } catch {
      setError(NETWORK_ERROR_MESSAGE);
    } finally {
      setUpdating(false);
    }
  }

  return <main className="wrap" dir="rtl">
    <h1>طلبات الدعم</h1>
    {error && <p role="alert" style={{ color: "#ff8fa3", margin: "8px 0" }}>{error}</p>}
    {/* auto-fit collapses to ONE column on phones; the old fixed 2-column grid overflowed. */}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap: 20, alignItems: "start" }}>
      <div>
        {loading ? <p className="muted" role="status">جارٍ تحميل التذاكر...</p> : null}
        {!loading && tickets.length === 0 ? <p className="muted">لا توجد تذاكر دعم حاليًا.</p> : null}
        <ul style={{ display: "grid", gap: 8, listStyle: "none", padding: 0, margin: 0 }}>{tickets.map((ticket) => <li key={ticket.id} className="glass card" style={{ padding: 12 }}>
          <button type="button" className="btn secondary" style={{ width: "100%", justifyContent: "flex-start", textAlign: "start" }} disabled={opening === ticket.id} aria-current={active?.id === ticket.id ? "true" : undefined} onClick={() => void select(ticket.id)}>{opening === ticket.id ? "جارٍ الفتح..." : ticket.subject}</button>
          <small className="muted" style={{ display: "block", marginTop: 6, overflowWrap: "anywhere" }}>{ticket.requester.username || ticket.requester.email} · {STATUS_LABELS[ticket.status] ?? ticket.status}</small>
        </li>)}</ul>
      </div>
      {active ? <section className="glass card" style={{ minWidth: 0 }}>
        <h2 style={{ overflowWrap: "anywhere" }}>{active.subject}</h2>
        <p className="muted" style={{ overflowWrap: "anywhere" }}>{active.requester.username || active.requester.email}</p>
        <label style={{ display: "block", margin: "10px 0" }}>الحالة <select className="input" value={active.status} disabled={updating} onChange={(event) => void changeStatus(event.target.value)}>{statuses.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}</select></label>
        <ol style={{ display: "grid", gap: 10, paddingInlineStart: 18 }}>{active.messages.map((item) => <li key={item.id}><strong>{item.authorRole === "SUPER_ADMIN" ? "الإدارة" : "المستخدم"}</strong><p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{item.body}</p><time className="muted" dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString("ar")}</time></li>)}</ol>
        {active.status !== "CLOSED" && <form onSubmit={(event) => void respond(event)} style={{ display: "grid", gap: 8, marginTop: 12 }}><label>رد الإدارة <textarea className="input" required maxLength={8000} rows={4} value={reply} disabled={sending} onChange={(event) => setReply(event.target.value)} /></label><button className="btn" type="submit" disabled={!reply.trim() || sending}>{sending ? "جارٍ الإرسال..." : "إرسال الرد"}</button></form>}
      </section> : <p className="muted">اختر تذكرة لعرضها.</p>}
    </div>
  </main>;
}
