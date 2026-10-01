"use client";

import { FormEvent, useEffect, useState } from "react";

type Ticket = { id: string; subject: string; status: string; updatedAt: string; _count?: { messages: number } };
type Message = { id: string; authorRole: string; body: string; createdAt: string };

const statusLabels: Record<string, string> = {
  OPEN: "مفتوحة",
  IN_PROGRESS: "قيد المعالجة",
  WAITING_USER: "بانتظار ردك",
  RESOLVED: "تم الحل",
  CLOSED: "مغلقة",
};

export default function SupportCenter() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [active, setActive] = useState<(Ticket & { messages: Message[] }) | null>(null);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadTickets() {
    const response = await fetch("/api/support/tickets", { cache: "no-store" });
    if (!response.ok) throw new Error("LOAD_FAILED");
    const result = await response.json();
    setTickets(result.data);
  }

  async function openTicket(id: string) {
    const response = await fetch(`/api/support/tickets/${id}`, { cache: "no-store" });
    if (!response.ok) throw new Error("TICKET_LOAD_FAILED");
    const result = await response.json();
    setActive(result.data);
  }

  useEffect(() => { void loadTickets().catch(() => setError("تعذر تحميل طلبات الدعم.")); }, []);

  async function createTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/support/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, message }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error("CREATE_FAILED");
      setSubject("");
      setMessage("");
      await loadTickets();
      await openTicket(result.data.id);
    } catch {
      setError("تعذر إرسال طلب الدعم. تحقق من الحقول وحاول مجددًا.");
    } finally {
      setBusy(false);
    }
  }

  async function sendReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/support/tickets/${active.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: reply }),
      });
      if (!response.ok) throw new Error("REPLY_FAILED");
      setReply("");
      await Promise.all([loadTickets(), openTicket(active.id)]);
    } catch {
      setError("تعذر إرسال الرد.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="wrap" dir="rtl">
    <h1>الدعم الفني</h1>
    <p>أرسل استفسارك وتابع الردود من هنا. محادثاتك خاصة بحسابك.</p>
    <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 0.8fr) minmax(0, 1.6fr)", gap: 20 }}>
      <section>
        <h2>طلب جديد</h2>
        <form onSubmit={(event) => void createTicket(event)}>
          <label>الموضوع <input required minLength={4} maxLength={160} value={subject} onChange={(event) => setSubject(event.target.value)} /></label>
          <label>التفاصيل <textarea required minLength={10} maxLength={8000} rows={5} value={message} onChange={(event) => setMessage(event.target.value)} /></label>
          <button type="submit" disabled={busy}>{busy ? "جارٍ الإرسال..." : "إرسال الطلب"}</button>
        </form>
        <h2>طلباتي</h2>
        <ul>{tickets.map((ticket) => <li key={ticket.id}><button type="button" onClick={() => void openTicket(ticket.id)}>{ticket.subject}</button> · {statusLabels[ticket.status] || ticket.status}</li>)}</ul>
      </section>
      <section aria-live="polite">
        {active ? <>
          <h2>{active.subject}</h2>
          <p>الحالة: {statusLabels[active.status] || active.status}</p>
          <ol>{active.messages.map((item) => <li key={item.id}>
            <strong>{item.authorRole === "USER" ? "أنت" : "الدعم"}</strong>
            <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{item.body}</p>
            <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString("ar")}</time>
          </li>)}</ol>
          {active.status !== "CLOSED" && <form onSubmit={(event) => void sendReply(event)}><label>ردك <textarea required maxLength={8000} value={reply} onChange={(event) => setReply(event.target.value)} /></label><button type="submit" disabled={busy || !reply.trim()}>إرسال الرد</button></form>}
        </> : <p>اختر طلبًا لمتابعة المحادثة.</p>}
      </section>
    </div>
    {error && <p role="alert">{error}</p>}
  </main>;
}