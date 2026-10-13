"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { aiErrorMessage, formatBalance, loadAiUsage, readApiError, type AiUsageSummary } from "@/components/ai/ai-errors";

const CHAT_CLIENT_TIMEOUT_MS = 290_000;

type Message = { id?: string; role: "user" | "assistant" | "system"; content: string };

export default function AiHubClient() {
  const [conversationId, setConversationId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<Array<{ id: string; title: string }>>([]);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [usage, setUsage] = useState<AiUsageSummary | null>(null);

  async function refreshUsage() {
    setUsage(await loadAiUsage());
  }

  async function loadConversations() {
    try {
      const response = await fetch("/api/gamevortex-ai/conversations", { cache: "no-store" });
      if (!response.ok) { setNotice(aiErrorMessage(await readApiError(response))); return; }
      const json = await response.json();
      const list = Array.isArray(json?.data) ? json.data : [];
      setConversations(list);
      setConversationId(current => current || list[0]?.id || "");
    } catch {
      setNotice("تعذر تحميل المحادثات. تحقق من الاتصال.");
    }
  }

  /** Returns the new conversation id, or "" when it could not be created. */
  async function createConversation(): Promise<string> {
    try {
      const response = await fetch("/api/gamevortex-ai/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New AI Chat" }),
      });
      if (!response.ok) { setNotice(aiErrorMessage(await readApiError(response))); return ""; }
      const json = await response.json();
      const id = typeof json?.data?.id === "string" ? json.data.id : "";
      if (!id) { setNotice(aiErrorMessage(null)); return ""; }
      setConversationId(id);
      setMessages([]);
      await loadConversations();
      return id;
    } catch {
      setNotice("تعذر إنشاء محادثة جديدة. تحقق من الاتصال.");
      return "";
    }
  }

  async function loadConversation(id: string) {
    if (!id) return;
    try {
      const response = await fetch("/api/gamevortex-ai/conversations/" + encodeURIComponent(id), { cache: "no-store" });
      if (!response.ok) { setNotice(aiErrorMessage(await readApiError(response))); return; }
      const json = await response.json();
      setMessages(Array.isArray(json?.data?.messages) ? json.data.messages : []);
    } catch {
      setNotice("تعذر تحميل المحادثة. تحقق من الاتصال.");
    }
  }

  useEffect(() => { void loadConversations(); void refreshUsage(); }, []);
  useEffect(() => {
    // While a send is in flight (including the conversation it just created) the
    // optimistic message list must not be replaced by a stale server copy.
    if (conversationId && !busy) void loadConversation(conversationId);
  }, [conversationId]);

  async function sendChat(event?: FormEvent) {
    event?.preventDefault();
    const text = prompt.trim();
    if (!text || busy) return;
    setBusy(true);
    setNotice("");

    // First message ever (no conversation yet): create one instead of silently doing nothing.
    let activeId = conversationId;
    if (!activeId) activeId = await createConversation();
    if (!activeId) { setBusy(false); return; }

    setPrompt("");
    setMessages(previous => [...previous, { role: "user", content: text }]);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHAT_CLIENT_TIMEOUT_MS);
    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text, conversationId: activeId, idempotencyKey: crypto.randomUUID() }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(await readApiError(response));
      const json = await response.json().catch(() => null);
      // The API answers { data: { answer } }. Anything else is treated as a failed request, never rendered blank.
      const answer = typeof json?.data?.answer === "string" ? json.data.answer.trim() : "";
      if (!answer) throw new Error("AI_EMPTY_RESPONSE");
      setMessages(previous => [...previous, { role: "assistant", content: answer }]);
      void refreshUsage();
      void loadConversations();
    } catch (error) {
      // The server removes the message and refunds the credits on failure, so
      // take the message back out of the list and give the text back to the user.
      setMessages(previous => {
        const index = previous.map(message => message.role === "user" && message.content === text).lastIndexOf(true);
        return index === -1 ? previous : previous.filter((_, position) => position !== index);
      });
      setPrompt(text);
      const code = controller.signal.aborted ? "CLIENT_TIMEOUT" : error instanceof Error ? error.message : "";
      setNotice(aiErrorMessage(code));
      void refreshUsage();
    } finally {
      clearTimeout(timer);
      setBusy(false);
    }
  }

  const activeTitle = useMemo(
    () => conversations.find(item => item.id === conversationId)?.title || "GameVortex AI",
    [conversations, conversationId],
  );

  return (
    <main className="gv-m-aihub" style={{ minHeight: "100dvh", padding: "24px", background: "var(--background, #09090b)", color: "var(--foreground, #fff)" }}>
      <div style={{ maxWidth: 1250, margin: "0 auto" }}>
        <header style={{ marginBottom: 24 }}>
          <div style={{ opacity: .65, fontSize: 13 }}>GameVortex Hub</div>
          <h1 className="gv-m-h1" style={{ fontSize: 34, margin: "6px 0" }}>GameVortex AI</h1>
          <p style={{ opacity: .7, margin: 0 }}>محادثة GameVortex AI.</p>
        </header>

        <section className="gv-m-split gv-m-split-aside" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 260px", gap: 16 }}>
          <div className="gv-m-chatbox" style={{ background: "#111113", border: "1px solid #27272a", borderRadius: 18, minHeight: 620, overflow: "hidden" }}>
            <div className="gv-m-chatcol" style={{ display: "flex", flexDirection: "column", minHeight: 620 }}>
              <nav aria-label="AI tools" style={{ padding: 10, borderBottom: "1px solid #27272a", display: "flex", gap: 8, flexWrap: "wrap" }}>
                <a href="/ai" aria-current="page" style={{ textDecoration: "none", color: "#fff", background: "#27272a", borderRadius: 9, padding: "8px 12px" }}>المحادثة</a>
                <a href="/ai/wallpapers" style={{ textDecoration: "none", color: "#fff", background: "#18181b", borderRadius: 9, padding: "8px 12px" }}>الفيديو</a>
              </nav>
              <div className="gv-m-chathead" style={{ padding: 16, borderBottom: "1px solid #27272a", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <strong>{activeTitle}</strong>
                <span style={{ opacity: .65, fontSize: 13 }}>{formatBalance(usage)}</span>
                <button type="button" disabled={busy} onClick={() => void createConversation()} style={{ border: 0, borderRadius: 9, padding: "8px 12px", cursor: "pointer" }}>محادثة جديدة</button>
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
              {notice && <div role="alert" style={{ margin: "0 14px", padding: 10, borderRadius: 10, background: "#2a1517", border: "1px solid #7f1d1d", color: "#fecaca", fontSize: 14 }}>{notice}</div>}
              <form className="gv-m-chatform" onSubmit={sendChat} style={{ padding: 14, borderTop: "1px solid #27272a", display: "flex", gap: 8 }}>
                <textarea value={prompt} onChange={event => setPrompt(event.target.value)} maxLength={6000} placeholder="اكتب رسالتك..." disabled={busy} style={{ flex: 1, minHeight: 60, resize: "vertical", borderRadius: 12, border: "1px solid #3f3f46", background: "#09090b", color: "#fff", padding: 12 }} />
                <button disabled={busy || !prompt.trim()} style={{ alignSelf: "stretch", border: 0, borderRadius: 12, padding: "0 18px", cursor: "pointer" }}>{busy ? "..." : "إرسال"}</button>
              </form>
            </div>
          </div>

          <aside style={{ background: "#111113", border: "1px solid #27272a", borderRadius: 18, padding: 16, height: "fit-content" }}>
            <strong>المحادثات</strong>
            <div style={{ marginTop: 12, display: "grid", gap: 6 }}>
              {conversations.map(item => (
                <button key={item.id} type="button" disabled={busy} onClick={() => { setNotice(""); setConversationId(item.id); }} style={{ textAlign: "right", border: 0, borderRadius: 9, padding: 10, background: item.id === conversationId ? "#27272a" : "transparent", color: "#fff", cursor: "pointer" }}>
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
