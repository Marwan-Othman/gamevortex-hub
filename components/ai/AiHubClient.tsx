"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Message = { id?: string; role: "user" | "assistant" | "system"; content: string };

export default function AiHubClient() {
  const [conversationId, setConversationId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<Array<{ id: string; title: string }>>([]);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadConversations() {
    const response = await fetch("/api/gamevortex-ai/conversations", { cache: "no-store" });
    const json = await response.json();
    const list = Array.isArray(json.data) ? json.data : [];
    setConversations(list);
    if (!conversationId && list[0]?.id) setConversationId(list[0].id);
  }

  async function createConversation() {
    const response = await fetch("/api/gamevortex-ai/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "New AI Chat" }),
    });
    const json = await response.json();
    if (json.data?.id) {
      setConversationId(json.data.id);
      setMessages([]);
      await loadConversations();
    }
  }

  async function loadConversation(id: string) {
    if (!id) return;
    const response = await fetch("/api/gamevortex-ai/conversations/" + id, { cache: "no-store" });
    const json = await response.json();
    setMessages(Array.isArray(json.data?.messages) ? json.data.messages : []);
  }

  useEffect(() => { void loadConversations(); }, []);
  useEffect(() => { if (conversationId) void loadConversation(conversationId); }, [conversationId]);

  async function sendChat(event?: FormEvent) {
    event?.preventDefault();
    const text = prompt.trim();
    if (!text || !conversationId || busy) return;
    setBusy(true);
    setPrompt("");
    setMessages(previous => [...previous, { role: "user", content: text }]);
    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text, conversationId, idempotencyKey: crypto.randomUUID() }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "AI_SERVICE_UNAVAILABLE");
      setMessages(previous => [...previous, { role: "assistant", content: json.data.answer }]);
    } catch {
      setMessages(previous => [...previous, { role: "assistant", content: "الخدمة غير متاحة مؤقتًا. حاول مرة أخرى." }]);
    } finally {
      setBusy(false);
    }
  }

  const activeTitle = useMemo(
    () => conversations.find(item => item.id === conversationId)?.title || "GameVortex AI",
    [conversations, conversationId],
  );

  return (
    <main style={{ minHeight: "100vh", padding: "24px", background: "var(--background, #09090b)", color: "var(--foreground, #fff)" }}>
      <div style={{ maxWidth: 1250, margin: "0 auto" }}>
        <header style={{ marginBottom: 24 }}>
          <div style={{ opacity: .65, fontSize: 13 }}>GameVortex Hub</div>
          <h1 style={{ fontSize: 34, margin: "6px 0" }}>GameVortex AI</h1>
          <p style={{ opacity: .7, margin: 0 }}>محادثة GameVortex AI فقط.</p>
        </header>

        <section style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 260px", gap: 16 }}>
          <div style={{ background: "#111113", border: "1px solid #27272a", borderRadius: 18, minHeight: 620, overflow: "hidden" }}>
            <div style={{ display: "flex", flexDirection: "column", minHeight: 620 }}>
              <div style={{ padding: 16, borderBottom: "1px solid #27272a", display: "flex", justifyContent: "space-between", gap: 12 }}>
                <strong>{activeTitle}</strong>
                <button onClick={() => void createConversation()} style={{ border: 0, borderRadius: 9, padding: "8px 12px", cursor: "pointer" }}>محادثة جديدة</button>
              </div>
              <div style={{ flex: 1, padding: 18, overflowY: "auto" }}>
                {!messages.length && <div style={{ opacity: .65, padding: 30, textAlign: "center" }}>ابدأ محادثة مع GameVortex AI.</div>}
                {messages.map((message, index) => (
                  <article key={message.id || String(index)} style={{ marginBottom: 14, padding: 14, borderRadius: 14, background: message.role === "user" ? "#18181b" : "#15151a", border: "1px solid #27272a" }}>
                    <div style={{ fontSize: 12, opacity: .55, marginBottom: 6 }}>{message.role === "user" ? "أنت" : "GameVortex AI"}</div>
                    <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{message.content}</div>
                  </article>
                ))}
              </div>
              <form onSubmit={sendChat} style={{ padding: 14, borderTop: "1px solid #27272a", display: "flex", gap: 8 }}>
                <textarea value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="اكتب رسالتك..." disabled={busy} style={{ flex: 1, minHeight: 60, resize: "vertical", borderRadius: 12, border: "1px solid #3f3f46", background: "#09090b", color: "#fff", padding: 12 }} />
                <button disabled={busy || !prompt.trim()} style={{ alignSelf: "stretch", border: 0, borderRadius: 12, padding: "0 18px", cursor: "pointer" }}>{busy ? "..." : "إرسال"}</button>
              </form>
            </div>
          </div>

          <aside style={{ background: "#111113", border: "1px solid #27272a", borderRadius: 18, padding: 16, height: "fit-content" }}>
            <strong>المحادثات</strong>
            <div style={{ marginTop: 12, display: "grid", gap: 6 }}>
              {conversations.map(item => (
                <button key={item.id} onClick={() => setConversationId(item.id)} style={{ textAlign: "right", border: 0, borderRadius: 9, padding: 10, background: item.id === conversationId ? "#27272a" : "transparent", color: "#fff", cursor: "pointer" }}>
                  {item.title}
                </button>
              ))}
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
