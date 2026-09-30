"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import styles from "./ai.module.css";
import { useLocale } from "@/components/ui/useLocale";

type Conversation = { id: string; title: string; updatedAt?: string };
type Message = { id?: string; role: string; content: string };
type MediaJob = {
  id: string;
  kind: "IMAGE" | "VIDEO";
  status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
  prompt: string;
  resultUrl?: string | null;
  errorMessage?: string | null;
  createdAt?: string;
};
type AiRequestError = Error & { requestId?: string };

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function inlineMarkdown(text: string) {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g).map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("*") && part.endsWith("*")) return <em key={index}>{part.slice(1, -1)}</em>;
    return part;
  });
}

function errorMessage(code: string, english: boolean) {
  const messages: Record<string, [string, string]> = {
    RUNTIME_NOT_CONFIGURED: ["محرك GameVortex AI غير مربوط بعد. أضف عنوان HTTPS لخادم Ollama الذي تملكه إلى GAMEVORTEX_AI_RUNTIME_URL في Vercel.", "GameVortex AI is not connected yet. Set GAMEVORTEX_AI_RUNTIME_URL in Vercel to the HTTPS address of your self-hosted Ollama gateway."],
    RUNTIME_TOKEN_NOT_CONFIGURED: ["أضف GAMEVORTEX_AI_RUNTIME_TOKEN في Vercel واجعله مطابقًا للرمز الموجود في خادم GameVortex AI.", "Set GAMEVORTEX_AI_RUNTIME_TOKEN in Vercel to the same secret configured on your GameVortex AI gateway."],
    RUNTIME_CONFIGURATION_INVALID: ["إعدادات محرك AI غير صالحة. راجع العنوان واسم النموذج والرمز.", "The AI runtime settings are invalid. Check the URL, model name, and token."],
    RUNTIME_UNREACHABLE: ["تعذر الوصول إلى خادم Ollama. تأكد أن الخادم يعمل وأن عنوان HTTPS يمكن الوصول إليه من Vercel.", "The Ollama server could not be reached. Check that it is running and that Vercel can reach its HTTPS address."],
    RUNTIME_TIMEOUT: ["انتهت مهلة انتظار النموذج. تحقق من أن النموذج محمّل وأن الخادم يستجيب.", "The model timed out. Check that the model is loaded and the runtime is responding."],
    RUNTIME_AUTH_FAILED: ["رفض خادم AI الرمز. يجب أن تتطابق قيمة GAMEVORTEX_AI_RUNTIME_TOKEN في Vercel والخادم.", "The AI gateway rejected its token. GAMEVORTEX_AI_RUNTIME_TOKEN must match in Vercel and on the gateway."],
    RUNTIME_ENDPOINT_INVALID: ["عنوان AI لا يشير إلى بوابة GameVortex الصحيحة.", "The AI URL does not point to a compatible GameVortex gateway."],
    RUNTIME_HTTP_ERROR: ["أعاد خادم AI خطأ. افحص سجلات بوابة GameVortex AI وOllama.", "The AI runtime returned an error. Check the GameVortex AI gateway and Ollama logs."],
    RUNTIME_INVALID_RESPONSE: ["أرسل خادم AI استجابة غير مفهومة.", "The AI runtime returned an invalid response."],
    RUNTIME_STREAM_FAILED: ["انقطع التوليد قبل اكتماله. أعد المحاولة.", "Generation stopped before it finished. Try again."],
    RUNTIME_EMPTY_RESPONSE: ["لم يُرجع النموذج أي نص.", "The model returned no text."],
    REGENERATION_NOT_AVAILABLE: ["لا توجد إجابة أخيرة صالحة لإعادة توليدها.", "There is no latest answer available to regenerate."],
    CONVERSATION_NOT_FOUND: ["لم يتم العثور على المحادثة.", "Conversation not found."],
    SENSITIVE_SITE_REQUEST_BLOCKED: ["لا أستطيع تزويدك بروابط أو معلومات داخلية/حساسة للموقع. يمكنني مساعدتك بالمعلومات العامة المتاحة للمستخدمين.", "I cannot provide protected or internal GameVortex links or information. I can help with public, user-facing information instead."],
    UNAUTHORIZED: ["انتهت جلسة الدخول. سجّل الدخول مجددًا.", "Your session has expired. Sign in again."],
    AI_MEDIA_INTERNAL_RUNTIME_NOT_CONFIGURED: ["محرك الوسائط المستقل غير مهيأ بعد. محادثة GameVortex AI تعمل بشكل مستقل عن مزودي الوسائط الخارجيين.", "The independent media runtime is not configured yet. GameVortex AI chat runs independently from external media providers."],
    AI_MEDIA_GENERATION_UNAVAILABLE: ["توليد الصور والفيديو غير متاح في محرك AI المستقل الحالي. لم تتم إضافة أي مزود خارجي.", "Image and video generation is unavailable in the current independent AI runtime. No external provider has been added."],
    AI_CREDITS_EXHAUSTED: ["انتهى رصيد هذه الميزة.", "Your credits for this feature are exhausted."],
    AI_SERVICE_UNAVAILABLE: ["تعذر إكمال الطلب. تحقق من إعدادات GameVortex AI.", "The request could not be completed. Check GameVortex AI settings."],
  };
  return messages[code]?.[english ? 1 : 0] || messages.AI_SERVICE_UNAVAILABLE[english ? 1 : 0];
}

export default function AiHubClient() {
  const locale = useLocale();
  const english = locale === "en";
  const [items, setItems] = useState<Conversation[]>([]);
  const [active, setActive] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [media, setMedia] = useState<MediaJob[]>([]);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [mediaBusy, setMediaBusy] = useState<"IMAGE" | "VIDEO" | null>(null);
  const [error, setError] = useState("");
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const aborter = useRef<AbortController | null>(null);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const t = (ar: string, en: string) => english ? en : ar;

  const speechLang = useMemo(() => {
    if (typeof navigator === "undefined") return english ? "en-US" : "ar-SA";
    const language = navigator.language || (english ? "en-US" : "ar-SA");
    return english ? language : language.startsWith("ar") ? language : "ar-SA";
  }, [english]);

  async function refresh() {
    try {
      const response = await fetch("/api/gamevortex-ai/conversations", { cache: "no-store" });
      if (!response.ok) throw new Error("AI_SERVICE_UNAVAILABLE");
      const result = await response.json();
      setItems(Array.isArray(result.data) ? result.data : []);
    } catch {
      setError(errorMessage("AI_SERVICE_UNAVAILABLE", english));
    }
  }

  async function refreshMedia(conversationId = active) {
    if (!conversationId) return;
    try {
      const response = await fetch(`/api/ai/media?conversationId=${encodeURIComponent(conversationId)}`, { cache: "no-store" });
      if (!response.ok) return;
      const result = await response.json();
      setMedia(Array.isArray(result.jobs) ? result.jobs : []);
    } catch { /* media history is non-blocking */ }
  }

  async function open(id: string) {
    try {
      const response = await fetch(`/api/gamevortex-ai/conversations/${id}`);
      if (!response.ok) {
        setError(errorMessage(response.status === 401 ? "UNAUTHORIZED" : "AI_SERVICE_UNAVAILABLE", english));
        return;
      }
      const { data } = await response.json();
      setActive(id);
      setMessages(data.messages);
      setError("");
      await refreshMedia(id);
    } catch {
      setError(errorMessage("AI_SERVICE_UNAVAILABLE", english));
    }
  }

  async function create() {
    try {
      const response = await fetch("/api/gamevortex-ai/conversations", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!response.ok) throw new Error(response.status === 401 ? "UNAUTHORIZED" : "AI_SERVICE_UNAVAILABLE");
      const { data } = await response.json();
      await refresh();
      await open(data.id);
    } catch (e) {
      setError(errorMessage(e instanceof Error ? e.message : "AI_SERVICE_UNAVAILABLE", english));
    }
  }

  async function remove(id: string) {
    try {
      const response = await fetch(`/api/gamevortex-ai/conversations/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(response.status === 401 ? "UNAUTHORIZED" : "AI_SERVICE_UNAVAILABLE");
      setItems((current) => current.filter((item) => item.id !== id));
      if (active === id) { setActive(""); setMessages([]); setMedia([]); }
    } catch (e) {
      setError(errorMessage(e instanceof Error ? e.message : "AI_SERVICE_UNAVAILABLE", english));
    }
  }

  async function rename(item: Conversation) {
    const title = window.prompt(t("اسم المحادثة", "Conversation title"), item.title);
    if (!title?.trim()) return;
    const response = await fetch(`/api/gamevortex-ai/conversations/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) });
    if (!response.ok) setError(errorMessage("AI_SERVICE_UNAVAILABLE", english));
    else await refresh();
  }

  useEffect(() => { void refresh(); }, []);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, media]);

  async function send(text = prompt, regenerate = false) {
    if (!text.trim() || busy) return;
    setError("");
    let conversationId = active;
    if (!conversationId) {
      try {
        const response = await fetch("/api/gamevortex-ai/conversations", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        if (!response.ok) throw new Error(response.status === 401 ? "UNAUTHORIZED" : "AI_SERVICE_UNAVAILABLE");
        const { data } = await response.json();
        conversationId = data.id;
        setActive(conversationId);
        void refresh();
      } catch (e) {
        setError(errorMessage(e instanceof Error ? e.message : "AI_SERVICE_UNAVAILABLE", english));
        return;
      }
    }

    const assistant: Message = { role: "assistant", content: "" };
    if (regenerate) setMessages((current) => [...current.slice(0, -1), assistant]);
    else setMessages((current) => [...current, { role: "user", content: text.trim() }, assistant]);
    setPrompt("");
    setBusy(true);
    const controller = new AbortController();
    aborter.current = controller;

    try {
      const response = await fetch("/api/gamevortex-ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId, prompt: text.trim(), regenerate }), signal: controller.signal });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const requestError = new Error(body.error || `HTTP_${response.status}`) as AiRequestError;
        requestError.requestId = body.requestId || response.headers.get("x-request-id") || undefined;
        throw requestError;
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("RUNTIME_INVALID_RESPONSE");
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        assistant.content += decoder.decode(value, { stream: true });
        setMessages((current) => [...current.slice(0, -1), { ...assistant }]);
      }
      assistant.content += decoder.decode();
      setMessages((current) => [...current.slice(0, -1), { ...assistant }]);
      await refreshMedia(conversationId);
      await refresh();
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setMessages((current) => current.filter((m) => m !== assistant));
      setError(errorMessage(e instanceof Error ? e.message : "AI_SERVICE_UNAVAILABLE", english));
    } finally {
      setBusy(false);
      aborter.current = null;
    }
  }

  async function ensureConversation() {
    if (active) return active;
    const response = await fetch("/api/gamevortex-ai/conversations", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    if (!response.ok) throw new Error(response.status === 401 ? "UNAUTHORIZED" : "AI_SERVICE_UNAVAILABLE");
    const { data } = await response.json();
    setActive(data.id);
    void refresh();
    return data.id as string;
  }

  async function generateMedia(kind: "IMAGE" | "VIDEO") {
    const text = prompt.trim();
    if (!text || mediaBusy) return;
    setMediaBusy(kind);
    setError("");
    try {
      const conversationId = await ensureConversation();
      const response = await fetch("/api/ai/media", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, prompt: text, conversationId, idempotencyKey: crypto.randomUUID() }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok && response.status !== 202) throw new Error(body.error || "AI_MEDIA_GENERATION_UNAVAILABLE");
      await refreshMedia(conversationId);
      setPrompt("");
      if (body.job?.status === "PROCESSING" || body.pollingRequired) pollMedia(body.job?.id || "");
    } catch (e) {
      setError(errorMessage(e instanceof Error ? e.message : "AI_MEDIA_GENERATION_UNAVAILABLE", english));
    } finally {
      setMediaBusy(null);
    }
  }

  async function pollMedia(id: string) {
    if (!id) return;
    for (let i = 0; i < 60; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      const response = await fetch(`/api/ai/media/${id}`, { cache: "no-store" });
      if (!response.ok) return;
      const body = await response.json();
      setMedia((current) => current.map((item) => item.id === id ? body.job : item));
      if (["COMPLETED", "FAILED"].includes(body.job?.status)) return;
    }
  }

  async function deleteMedia(id: string) {
    const response = await fetch(`/api/ai/media/${id}`, { method: "DELETE" });
    if (!response.ok) {
      setError(errorMessage("AI_SERVICE_UNAVAILABLE", english));
      return;
    }
    setMedia((current) => current.filter((item) => item.id !== id));
  }

  function startVoice() {
    setVoiceOpen(true);
    const SpeechRecognition = (window as Window & { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor }).SpeechRecognition || (window as Window & { webkitSpeechRecognition?: SpeechRecognitionCtor }).webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    const instance = new SpeechRecognition();
    instance.lang = speechLang;
    instance.continuous = false;
    instance.interimResults = false;
    instance.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript || "";
      if (transcript) setPrompt(transcript);
    };
    instance.onerror = () => setListening(false);
    instance.onend = () => setListening(false);
    recognition.current = instance;
    setListening(true);
    instance.start();
  }

  function stopVoice() {
    recognition.current?.stop();
    recognition.current = null;
    setListening(false);
  }

  function speakLatest() {
    const text = [...messages].reverse().find((message) => message.role === "assistant")?.content;
    if (!text || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = speechLang;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }

  useEffect(() => () => { recognition.current?.stop(); window.speechSynthesis?.cancel(); }, []);

  return (
    <main className={styles.aiHub} dir={english ? "ltr" : "rtl"}>
      <header className={styles.header}>
        <div>
          <span className={styles.kicker}>GAMEVORTEX AI</span>
          <h1>{t("مركز الذكاء الاصطناعي", "AI Hub")}</h1>
          <p>{t("محادثة، صوت، صور وفيديو في مساحة واحدة.", "Chat, voice, images and video in one workspace.")}</p>
        </div>
        <button className={styles.primaryButton} onClick={() => void create()}>{t("محادثة جديدة", "New chat")}</button>
      </header>

      {error && <div className={styles.notice}>{error}</div>}

      <section className={styles.workArea}>
        <aside className={styles.sidebar}>
          <div className={styles.sidebarHead}><h3>{t("المحادثات", "Conversations")}</h3><button onClick={() => void create()}>＋</button></div>
          {items.map((item) => (
            <div className={`${styles.historyRow} ${active === item.id ? styles.activeRow : ""}`} key={item.id}>
              <button onClick={() => void open(item.id)}>{item.title}</button>
              <button onClick={() => void rename(item)} aria-label={t("تعديل", "Rename")}>✎</button>
              <button onClick={() => void remove(item.id)} aria-label={t("حذف", "Delete")}>×</button>
            </div>
          ))}
        </aside>

        <div className={styles.chatPanel}>
          <div className={styles.messages}>
            {!messages.length && !media.length && <div className={styles.welcome}><div className={styles.orbSmall}>✦</div><h2>{t("مرحبًا بك في GameVortex AI", "Welcome to GameVortex AI")}</h2><p>{t("اكتب طلبك أو استخدم الصوت أو أنشئ صورة وفيديو.", "Write a prompt, use voice, or create an image or video.")}</p></div>}
            {messages.map((message, index) => (
              <article key={message.id || `${message.role}-${index}`} className={`${styles.message} ${message.role === "user" ? styles.userMessage : styles.aiMessage}`}>
                <strong>{message.role === "user" ? t("أنت", "You") : "GameVortex AI"}</strong>
                <div className={styles.markdown}>{inlineMarkdown(message.content || (busy && index === messages.length - 1 ? "…" : ""))}</div>
                {message.role === "assistant" && message.content && !busy && <div className={styles.messageActions}><button onClick={speakLatest}>🔊</button><button onClick={() => navigator.clipboard?.writeText(message.content)}>⧉</button><button onClick={() => { const previous = [...messages.slice(0, index)].reverse().find((m) => m.role === "user")?.content; if (previous) void send(previous, true); }}>↻</button></div>}
              </article>
            ))}
            {media.map((job) => (
              <article className={styles.mediaCard} key={job.id}>
                <div className={styles.mediaMeta}><span>{job.kind === "IMAGE" ? "🖼️" : "🎬"} {job.kind === "IMAGE" ? t("صورة AI", "AI Image") : t("فيديو AI", "AI Video")}</span><button onClick={() => void deleteMedia(job.id)} aria-label={t("حذف الوسائط", "Delete media")}>🗑️</button></div>
                {job.status !== "COMPLETED" && <div className={styles.mediaStatus}>{job.status === "FAILED" ? t("فشل الإنشاء", "Generation failed") : t("جاري الإنشاء…", "Generating…")}</div>}
                {job.status === "COMPLETED" && job.resultUrl && (job.kind === "IMAGE" ? <img src={job.resultUrl} alt={job.prompt} className={styles.mediaResult} /> : <video src={job.resultUrl} className={styles.mediaResult} controls playsInline />)}
                <p>{job.prompt}</p>
              </article>
            ))}
            <div ref={bottom} />
          </div>

          <form className={styles.composer} onSubmit={(event) => { event.preventDefault(); void send(); }}>
            <button type="button" className={styles.voiceButton} onClick={startVoice} title={t("محادثة صوتية", "Voice chat")}>🎙️</button>
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t("اسأل GameVortex AI...", "Ask GameVortex AI...")} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
            <button type="button" onClick={() => void generateMedia("IMAGE")} disabled={!prompt.trim() || !!mediaBusy || busy}>🖼️</button>
            <button type="button" onClick={() => void generateMedia("VIDEO")} disabled={!prompt.trim() || !!mediaBusy || busy}>🎬</button>
            <button type="submit" disabled={busy || !prompt.trim()}>{busy ? "…" : "↑"}</button>
            {busy && <button type="button" onClick={() => aborter.current?.abort()}>{t("إيقاف", "Stop")}</button>}
          </form>
          <div className={styles.status}>{t("زر الصوت متاح دائمًا. وضع الصوت يستخدم قدرات المتصفح المدعومة.", "Voice is always available. Voice mode uses the browser's supported speech capabilities.")}</div>
        </div>
      </section>

      {voiceOpen && <div className={styles.voiceOverlay} role="dialog" aria-modal="true">
        <div className={styles.voiceTop}><span>GAMEVORTEX AI</span><button onClick={() => { stopVoice(); setVoiceOpen(false); }}>×</button></div>
        <div className={`${styles.voiceOrb} ${listening ? styles.listening : speaking ? styles.speaking : ""}`}><span>✦</span></div>
        <h2>{listening ? t("أستمع إليك…", "Listening…") : speaking ? t("GameVortex AI يتحدث…", "GameVortex AI is speaking…") : t("المحادثة الصوتية", "Voice chat")}</h2>
        <p>{t("تحدث بشكل طبيعي، ثم أرسل النص المحوّل إلى المحادثة.", "Speak naturally, then send the transcribed text to the conversation.")}</p>
        <div className={styles.voiceControls}>
          <button onClick={listening ? stopVoice : startVoice}>{listening ? "🔇" : "🎙️"}</button>
          <button onClick={() => { stopVoice(); setVoiceOpen(false); }}>✕</button>
          <button onClick={speakLatest}>🔊</button>
        </div>
        {prompt && <div className={styles.voiceTranscript}>{prompt}</div>}
        <button className={styles.voiceSend} onClick={() => { setVoiceOpen(false); void send(); }}>{t("إرسال إلى المحادثة", "Send to chat")}</button>
      </div>}
    </main>
  );
}
