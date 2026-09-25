"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Globe, Send, Sparkles } from "lucide-react";
import styles from "./ai.module.css";

const QUICK = [
  "اقترح لي لعبة رعب مميزة",
  "ما أفضل لعبة تقمص أدوار في المنصة؟",
  "ألعاب مناسبة للعب مع الأصدقاء",
  "قارن بين لعبتين في GameVortex",
];

const GREETING =
  "مرحبًا بك في GameVortex AI 🎮\nأنا مساعدك الذكي داخل المنصة. اسألني عن الألعاب أو اطلب اقتراحات ومقارنات من بيانات GameVortex الحقيقية.";

type Message = { role: "user" | "assistant"; content: string };
type Credits = { planCode?: string; chatCredits?: number; isOwner?: boolean; isVip?: boolean } | null;

export default function AIChat() {
  const [messages, setMessages] = useState<Message[]>([{ role: "assistant", content: GREETING }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [credits, setCredits] = useState<Credits>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    fetch("/api/vip/status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setCredits(data?.data ?? null))
      .catch(() => undefined);
  }, []);

  async function send(text?: string) {
    const message = (text ?? input).trim();
    if (!message || loading) return;

    setError("");
    setInput("");
    setMessages((current) => [...current, { role: "user", content: message }]);
    setLoading(true);

    try {
      const history = messages.slice(-8).map((m) => ({ role: m.role, content: m.content }));
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, history, stream: false }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "حدث خطأ أثناء الاتصال بالمساعد الذكي.");
      }

      const reply = typeof data?.answer === "string" ? data.answer : "تعذر إنشاء رد.";
      setMessages((current) => [...current, { role: "assistant", content: reply }]);
      setCredits((current) => current ? ({ ...current, chatCredits: typeof current.chatCredits === "number" ? Math.max(0, current.chatCredits - 1) : current.chatCredits }) : current);
    } catch (err) {
      const messageText = err instanceof Error ? err.message : "حدث خطأ غير متوقع. حاول مجددًا.";
      setError(messageText);
      setMessages((current) => [...current, { role: "assistant", content: `${messageText}\n\nيمكنك مراجعة باقة VIP إذا انتهى رصيدك.` }]);
    } finally {
      setLoading(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send();
  }

  const unlimited = Boolean(credits?.isOwner);
  const remaining = unlimited ? "∞" : typeof credits?.chatCredits === "number" ? credits.chatCredits.toLocaleString("en-US") : "—";

  return (
    <div className={styles.newChatShell}>
      <div className={styles.newChatHeader}>
        <div className={styles.newChatIdentity}>
          <span className={styles.newChatIcon}><Sparkles size={17} /></span>
          <div><strong>محادثة GameVortex AI</strong><div className={styles.connected}><span />متصل</div></div>
        </div>
        <div className={styles.webSearchBadge}><Globe size={13} /> GameVortex Knowledge</div>
      </div>

      <div className={styles.newMessages}>
        {messages.map((message, index) => (
          <div key={`${message.role}-${index}`} className={`${styles.newMessage} ${message.role === "user" ? styles.newUserMessage : styles.newAssistantMessage}`}>
            {message.content}
          </div>
        ))}
        {loading && <div className={`${styles.newMessage} ${styles.newAssistantMessage} ${styles.typing}`}><span /><span /><span /></div>}
        <div ref={endRef} />
      </div>

      <div className={styles.newCredits}>
        <span>الباقة: {credits?.isVip || credits?.isOwner ? "VIP" : "مجاني"}</span>
        <span>الرصيد المتبقي: {remaining} رسالة</span>
        {!credits?.isVip && !credits?.isOwner && <Link href="/vip">ترقية إلى VIP</Link>}
      </div>

      <form className={styles.newComposer} onSubmit={onSubmit}>
        <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="اكتب سؤالك هنا..." aria-label="رسالة" disabled={loading} />
        <button type="submit" disabled={loading || !input.trim()} aria-label="إرسال"><Send size={17} /></button>
      </form>

      <div className={styles.quickPrompts}>
        {QUICK.map((prompt) => <button key={prompt} type="button" onClick={() => void send(prompt)} disabled={loading}>{prompt}</button>)}
      </div>
      {error && <p className={styles.newError} role="alert">{error}</p>}
    </div>
  );
}
