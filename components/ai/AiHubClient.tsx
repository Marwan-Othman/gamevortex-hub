"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Mode = "CHAT" | "IMAGE" | "VIDEO" | "TOOLS" | "USAGE";
type Message = { id?: string; role: "user" | "assistant" | "system"; content: string };

const tools = [
  ["summarize", "تلخيص", "لخّص النص التالي بدقة مع الحفاظ على النقاط المهمة:"],
  ["rewrite", "إعادة كتابة", "أعد كتابة النص التالي بصياغة احترافية وواضحة:"],
  ["translate", "ترجمة", "ترجم النص التالي إلى الإنجليزية مع الحفاظ على المعنى:"],
  ["ideas", "أفكار", "اقترح أفكارًا عملية ومبتكرة بناءً على:"],
];

export default function AiHubClient() {
  const [mode, setMode] = useState<Mode>("CHAT");
  const [conversationId, setConversationId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<Array<{ id: string; title: string }>>([]);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaKind, setMediaKind] = useState<"IMAGE" | "VIDEO">("IMAGE");
  const [file, setFile] = useState<File | null>(null);
  const [usage, setUsage] = useState<{ balance: number | null; unlimited: boolean; vip: { isVip: boolean; planCode: string; expiresAt: string | null }; recent: Array<{ provider: string; operation: string; status: string; gvcUsed: number; gvcRefunded: number }> } | null>(null);

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

  async function loadUsage() {
    const response = await fetch("/api/ai/usage", { cache: "no-store" });
    if (response.ok) setUsage(await response.json());
  }

  useEffect(() => { void loadConversations(); void loadUsage(); }, []);
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
      void loadUsage();
    } catch {
      setMessages(previous => [...previous, { role: "assistant", content: "الخدمة غير متاحة مؤقتًا. حاول مرة أخرى." }]);
    } finally {
      setBusy(false);
    }
  }

  async function generateMedia(event?: FormEvent) {
    event?.preventDefault();
    const text = prompt.trim();
    if (!text || busy || !conversationId) return;
    setBusy(true);
    setMediaUrl("");
    try {
      const form = new FormData();
      form.set("kind", mediaKind);
      form.set("prompt", text);
      form.set("conversationId", conversationId);
      form.set("idempotencyKey", crypto.randomUUID());
      if (file) form.set("image", file);
      const response = await fetch("/api/ai/media", { method: "POST", body: form });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "AI_MEDIA_GENERATION_FAILED");
      setMediaUrl(json.job?.resultUrl || "");
      void loadUsage();
    } catch {
      setMediaUrl("");
      alert("تعذر تنفيذ عملية الإنشاء حاليًا.");
    } finally {
      setBusy(false);
    }
  }

  const activeTitle = useMemo(() => conversations.find(item => item.id === conversationId)?.title || "GameVortex AI", [conversations, conversationId]);

  return (
    <main style={{ minHeight: "100vh", padding: "24px", background: "var(--background, #09090b)", color: "var(--foreground, #fff)" }}>
      <div style={{ maxWidth: 1250, margin: "0 auto" }}>
        <header style={{ marginBottom: 24 }}>
          <div style={{ opacity: .65, fontSize: 13 }}>GameVortex Hub</div>
          <h1 style={{ fontSize: 34, margin: "6px 0" }}>GameVortex AI</h1>
          <p style={{ opacity: .7, margin: 0 }}>مركز موحد للدردشة، الصور، الفيديو وأدوات الذكاء الاصطناعي.</p>
        </header>

        <nav style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
          {(["CHAT", "IMAGE", "VIDEO", "TOOLS", "USAGE"] as Mode[]).map(item => (
            <button key={item} onClick={() => setMode(item)} style={{ border: 0, borderRadius: 10, padding: "10px 15px", cursor: "pointer", background: mode === item ? "#fff" : "#18181b", color: mode === item ? "#09090b" : "#fff" }}>
              {item === "CHAT" ? "المحادثة" : item === "IMAGE" ? "الصور" : item === "VIDEO" ? "الفيديو" : item === "TOOLS" ? "الأدوات" : "الرصيد والاستخدام"}
            </button>
          ))}
        </nav>

        <section style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 260px", gap: 16 }}>
          <div style={{ background: "#111113", border: "1px solid #27272a", borderRadius: 18, minHeight: 620, overflow: "hidden" }}>
            {mode === "CHAT" && (
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
                  <textarea value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="اكتب طلبك..." disabled={busy} style={{ flex: 1, minHeight: 60, resize: "vertical", borderRadius: 12, border: "1px solid #3f3f46", background: "#09090b", color: "#fff", padding: 12 }} />
                  <button disabled={busy || !prompt.trim()} style={{ alignSelf: "stretch", border: 0, borderRadius: 12, padding: "0 18px", cursor: "pointer" }}>{busy ? "..." : "إرسال"}</button>
                </form>
              </div>
            )}

            {(mode === "IMAGE" || mode === "VIDEO") && (
              <form onSubmit={generateMedia} style={{ padding: 24 }}>
                <h2>{mode === "IMAGE" ? "إنشاء وتعديل الصور" : "إنشاء الفيديو"}</h2>
                <p style={{ opacity: .65 }}>المعالجة تتم على الخادم ولا يتم كشف مفاتيح مزودي الخدمة للمتصفح.</p>
                <textarea value={prompt} onChange={event => setPrompt(event.target.value)} placeholder={mode === "IMAGE" ? "صف الصورة أو التعديل المطلوب..." : "صف الفيديو المطلوب..."} style={{ width: "100%", minHeight: 150, borderRadius: 12, padding: 14, background: "#09090b", color: "#fff", border: "1px solid #3f3f46" }} />
                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => setFile(event.target.files?.[0] || null)} style={{ marginTop: 14 }} />
                <button disabled={busy || !prompt.trim()} style={{ marginTop: 14, border: 0, borderRadius: 10, padding: "11px 18px", cursor: "pointer" }}>{busy ? "جاري الإنشاء..." : "إنشاء"}</button>
                {mediaUrl && <div style={{ marginTop: 20 }}>{mediaKind === "VIDEO" ? <video controls src={mediaUrl} style={{ maxWidth: "100%", borderRadius: 14 }} /> : <img src={mediaUrl} alt="Generated" style={{ maxWidth: "100%", borderRadius: 14 }} />}<div><a href={mediaUrl} download style={{ display: "inline-block", marginTop: 10 }}>حفظ النتيجة</a></div></div>}
              </form>
            )}

            {mode === "TOOLS" && (
              <div style={{ padding: 24 }}>
                <h2>أدوات AI</h2>
                <p style={{ opacity: .65 }}>هذه الأدوات تستخدم Gateway نفسه ولا تحتوي على ردود وهمية.</p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
                  {tools.map(([id, label, prefix]) => <button key={id} onClick={() => { setMode("CHAT"); setPrompt(prefix + "\n"); }} style={{ textAlign: "right", padding: 18, borderRadius: 14, border: "1px solid #27272a", background: "#18181b", color: "#fff", cursor: "pointer" }}><strong>{label}</strong><div style={{ opacity: .6, marginTop: 6 }}>استخدم GameVortex AI لتنفيذها</div></button>)}
                </div>
              </div>
            )}

            {mode === "USAGE" && (
              <div style={{ padding: 24 }}>
                <h2>الرصيد والاستخدام</h2>
                <div style={{ padding: 18, borderRadius: 14, background: "#18181b", marginBottom: 18 }}>
                  <div style={{ opacity: .6 }}>الحالة</div>
                  <strong>{usage?.vip?.isVip ? "VIP · " + usage.vip.planCode : "Free"}</strong>
                  <div style={{ marginTop: 10, fontSize: 28 }}>{usage?.unlimited ? "Unlimited" : String(usage?.balance ?? 0) + " GVC"}</div>
                </div>
                <div style={{ display: "grid", gap: 8 }}>
                  {(usage?.recent || []).map((item, index) => <div key={String(index)} style={{ padding: 12, borderBottom: "1px solid #27272a", display: "flex", justifyContent: "space-between" }}><span>{item.operation} · {item.provider}</span><span>{item.status}</span></div>)}
                </div>
              </div>
            )}
          </div>

          <aside style={{ background: "#111113", border: "1px solid #27272a", borderRadius: 18, padding: 16, height: "fit-content" }}>
            <strong>المحادثات</strong>
            <div style={{ marginTop: 12, display: "grid", gap: 6 }}>
              {conversations.map(item => <button key={item.id} onClick={() => setConversationId(item.id)} style={{ textAlign: "right", border: 0, borderRadius: 9, padding: 10, background: item.id === conversationId ? "#27272a" : "transparent", color: "#fff", cursor: "pointer" }}>{item.title}</button>)}
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
