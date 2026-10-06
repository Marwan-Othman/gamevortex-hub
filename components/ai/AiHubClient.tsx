"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Message = { id?: string; role: "user" | "assistant" | "system"; content: string };
type MediaJob = {
  id: string;
  kind: "IMAGE" | "VIDEO";
  status: string;
  prompt: string;
  resultUrl?: string | null;
  createdAt: string;
};

export default function AiHubClient() {
  const [conversationId, setConversationId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<Array<{ id: string; title: string }>>([]);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);

  const [mediaMode, setMediaMode] = useState<"IMAGE" | "VIDEO">("IMAGE");
  const [mediaPrompt, setMediaPrompt] = useState("");
  const [mediaOperation, setMediaOperation] = useState<"GENERATE" | "EDIT">("GENERATE");
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const [mediaResult, setMediaResult] = useState<MediaJob | null>(null);
  const [mediaJobs, setMediaJobs] = useState<MediaJob[]>([]);

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
      setMediaJobs([]);
      await loadConversations();
    }
  }

  async function loadConversation(id: string) {
    if (!id) return;
    const response = await fetch("/api/gamevortex-ai/conversations/" + id, { cache: "no-store" });
    const json = await response.json();
    setMessages(Array.isArray(json.data?.messages) ? json.data.messages : []);
  }

  async function loadMediaJobs(id: string) {
    if (!id) {
      setMediaJobs([]);
      return;
    }
    try {
      const response = await fetch("/api/ai/media?conversationId=" + encodeURIComponent(id), { cache: "no-store" });
      const json = await response.json();
      setMediaJobs(Array.isArray(json.jobs) ? json.jobs : []);
    } catch {
      setMediaJobs([]);
    }
  }

  useEffect(() => { void loadConversations(); }, []);
  useEffect(() => {
    if (conversationId) {
      void loadConversation(conversationId);
      void loadMediaJobs(conversationId);
    }
  }, [conversationId]);

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

  async function generateMedia(event?: FormEvent) {
    event?.preventDefault();
    const text = mediaPrompt.trim();
    if (!text || mediaBusy) return;

    setMediaBusy(true);
    setMediaError("");
    setMediaResult(null);

    try {
      const form = new FormData();
      form.set("kind", mediaMode);
      form.set("operation", mediaMode === "VIDEO" ? (mediaFile ? "EDIT" : "GENERATE") : mediaOperation);
      form.set("prompt", text);
      form.set("conversationId", conversationId);
      form.set("idempotencyKey", crypto.randomUUID());

      if (mediaMode === "IMAGE") {
        form.set("aspectRatio", "1:1");
        form.set("imageSize", "1K");
      }
      if (mediaFile) form.set("image", mediaFile);

      const response = await fetch("/api/ai/media", {
        method: "POST",
        body: form,
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || "AI_MEDIA_GENERATION_FAILED");

      const job = json.job as MediaJob;
      setMediaResult(job);
      setMediaPrompt("");
      setMediaFile(null);
      const fileInput = document.getElementById("gamevortex-ai-media-file") as HTMLInputElement | null;
      if (fileInput) fileInput.value = "";
      await loadMediaJobs(conversationId);
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (code === "AI_VIP_REQUIRED") setMediaError("ميزة الصور والفيديو متاحة لمشتركي VIP.");
      else if (code === "AI_CREDITS_EXHAUSTED") setMediaError("رصيد GVC غير كافٍ لهذه العملية.");
      else if (code === "INVALID_IMAGE_TYPE") setMediaError("نوع الصورة غير مدعوم. استخدم PNG أو JPG أو WebP.");
      else if (code === "IMAGE_TOO_LARGE") setMediaError("حجم الصورة أكبر من الحد المسموح.");
      else setMediaError("تعذر إنشاء الوسائط. تحقق من إعدادات AI وحاول مرة أخرى.");
    } finally {
      setMediaBusy(false);
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
          <p style={{ opacity: .7, margin: 0 }}>محادثة وإنشاء صور وفيديوهات بالذكاء الاصطناعي.</p>
        </header>

        <section style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 260px", gap: 16 }}>
          <div style={{ display: "grid", gap: 16 }}>
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

            <section style={{ background: "#111113", border: "1px solid #27272a", borderRadius: 18, padding: 18 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
                <div>
                  <strong>استوديو الوسائط</strong>
                  <div style={{ opacity: .6, fontSize: 13, marginTop: 4 }}>إنشاء أو تعديل الصور والفيديوهات من نفس حساب GameVortex.</div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button type="button" onClick={() => { setMediaMode("IMAGE"); setMediaError(""); }} style={{ border: "1px solid #3f3f46", borderRadius: 9, padding: "8px 12px", background: mediaMode === "IMAGE" ? "#27272a" : "transparent", color: "#fff", cursor: "pointer" }}>صورة</button>
                  <button type="button" onClick={() => { setMediaMode("VIDEO"); setMediaError(""); }} style={{ border: "1px solid #3f3f46", borderRadius: 9, padding: "8px 12px", background: mediaMode === "VIDEO" ? "#27272a" : "transparent", color: "#fff", cursor: "pointer" }}>فيديو</button>
                </div>
              </div>

              <form onSubmit={generateMedia} style={{ display: "grid", gap: 10 }}>
                <textarea
                  value={mediaPrompt}
                  onChange={event => setMediaPrompt(event.target.value)}
                  placeholder={mediaMode === "IMAGE" ? "صف الصورة التي تريد إنشاءها..." : "صف الفيديو الذي تريد إنشاءه..."}
                  disabled={mediaBusy}
                  style={{ minHeight: 100, resize: "vertical", borderRadius: 12, border: "1px solid #3f3f46", background: "#09090b", color: "#fff", padding: 12 }}
                />

                {mediaMode === "IMAGE" && (
                  <select value={mediaOperation} onChange={event => setMediaOperation(event.target.value as "GENERATE" | "EDIT")} disabled={mediaBusy} style={{ borderRadius: 10, border: "1px solid #3f3f46", background: "#09090b", color: "#fff", padding: 10 }}>
                    <option value="GENERATE">إنشاء صورة جديدة</option>
                    <option value="EDIT">تعديل/تحويل صورة</option>
                  </select>
                )}

                <label style={{ display: "grid", gap: 6, fontSize: 13, opacity: .85 }}>
                  {mediaMode === "IMAGE" ? "صورة مرجعية (اختياري للتعديل)" : "صورة بداية للفيديو (اختياري)"}
                  <input id="gamevortex-ai-media-file" type="file" accept="image/png,image/jpeg,image/webp" disabled={mediaBusy} onChange={event => setMediaFile(event.target.files?.[0] || null)} />
                </label>

                {mediaFile && <div style={{ fontSize: 12, opacity: .6 }}>{mediaFile.name}</div>}
                {mediaError && <div style={{ color: "#fca5a5", fontSize: 13 }}>{mediaError}</div>}

                <button type="submit" disabled={mediaBusy || !mediaPrompt.trim()} style={{ border: 0, borderRadius: 12, padding: "12px 16px", cursor: "pointer" }}>
                  {mediaBusy ? "جاري الإنشاء..." : mediaMode === "IMAGE" ? "إنشاء الصورة" : "إنشاء الفيديو"}
                </button>
              </form>

              {mediaResult?.resultUrl && (
                <div style={{ marginTop: 18, borderTop: "1px solid #27272a", paddingTop: 18 }}>
                  <strong>النتيجة</strong>
                  <div style={{ marginTop: 10 }}>
                    {mediaResult.kind === "IMAGE" ? (
                      <img src={mediaResult.resultUrl} alt={mediaResult.prompt} style={{ display: "block", width: "100%", maxHeight: 560, objectFit: "contain", borderRadius: 12, background: "#09090b" }} />
                    ) : (
                      <video src={mediaResult.resultUrl} controls playsInline style={{ display: "block", width: "100%", maxHeight: 560, borderRadius: 12, background: "#09090b" }} />
                    )}
                  </div>
                  <a href={mediaResult.resultUrl} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: 10 }}>فتح النتيجة</a>
                </div>
              )}

              {mediaJobs.length > 0 && (
                <div style={{ marginTop: 18, borderTop: "1px solid #27272a", paddingTop: 18 }}>
                  <strong>آخر النتائج</strong>
                  <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                    {mediaJobs.slice(0, 6).map(job => (
                      <button key={job.id} type="button" onClick={() => setMediaResult(job)} style={{ textAlign: "right", border: "1px solid #27272a", borderRadius: 10, padding: 10, background: "#09090b", color: "#fff", cursor: "pointer" }}>
                        <div style={{ fontSize: 12, opacity: .6 }}>{job.kind === "IMAGE" ? "صورة" : "فيديو"} · {job.status}</div>
                        <div style={{ marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{job.prompt}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </section>
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
