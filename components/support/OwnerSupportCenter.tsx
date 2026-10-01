"use client";

import { FormEvent, useEffect, useState } from "react";

type Ticket = { id: string; subject: string; status: string; requester: { email: string; username: string | null } };
type Message = { id: string; authorRole: string; body: string; createdAt: string };
type Detail = Ticket & { messages: Message[] };

const statuses = ["OPEN", "IN_PROGRESS", "WAITING_USER", "RESOLVED", "CLOSED"];

export default function OwnerSupportCenter() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [active, setActive] = useState<Detail | null>(null);
  const [reply, setReply] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const response = await fetch("/api/admin/support/tickets", { cache: "no-store" });
    if (!response.ok) throw new Error("LOAD_FAILED");
    const result = await response.json();
    setTickets(result.data);
  }

  async function select(id: string) {
    const response = await fetch(`/api/admin/support/tickets/${id}`, { cache: "no-store" });
    if (!response.ok) throw new Error("DETAIL_FAILED");
    const result = await response.json();
    setActive(result.data);
  }

  useEffect(() => { void load().catch(() => setError("تعذر تحميل التذاكر.")); }, []);

  async function respond(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active) return;
    try {
      const response = await fetch(`/api/admin/support/tickets/${active.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: reply }) });
      if (!response.ok) throw new Error("REPLY_FAILED");
      setReply("");
      await Promise.all([load(), select(active.id)]);
    } catch {
      setError("تعذر إرسال الرد.");
    }
  }

  async function changeStatus(status: string) {
    if (!active) return;
    try {
      const response = await fetch(`/api/admin/support/tickets/${active.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      if (!response.ok) throw new Error("STATUS_FAILED");
      await Promise.all([load(), select(active.id)]);
    } catch {
      setError("تعذر تحديث الحالة.");
    }
  }

  return <main className="wrap" dir="rtl">
    <h1>طلبات الدعم</h1>
    <div style={{ display: "grid", gridTemplateColumns: "minmax(240px, 0.8fr) minmax(0, 1.6fr)", gap: 20 }}>
      <ul>{tickets.map((ticket) => <li key={ticket.id}><button type="button" onClick={() => void select(ticket.id)}>{ticket.subject}</button><small> · {ticket.requester.username || ticket.requester.email} · {ticket.status}</small></li>)}</ul>
      {active ? <section>
        <h2>{active.subject}</h2>
        <p>{active.requester.username || active.requester.email}</p>
        <label>الحالة <select value={active.status} onChange={(event) => void changeStatus(event.target.value)}>{statuses.map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
        <ol>{active.messages.map((item) => <li key={item.id}><strong>{item.authorRole === "SUPER_ADMIN" ? "الإدارة" : "المستخدم"}</strong><p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{item.body}</p><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString("ar")}</time></li>)}</ol>
        {active.status !== "CLOSED" && <form onSubmit={(event) => void respond(event)}><label>رد الإدارة <textarea required maxLength={8000} value={reply} onChange={(event) => setReply(event.target.value)} /></label><button type="submit" disabled={!reply.trim()}>إرسال الرد</button></form>}
      </section> : <p>اختر تذكرة لعرضها.</p>}
    </div>
    {error && <p role="alert">{error}</p>}
  </main>;
}