"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./ai.module.css";
import { useLocale } from "@/components/ui/useLocale";

type Conversation = { id: string; title: string; updatedAt?: string };
type Message = { id?: string; role: string; content: string };
type AiRequestError = Error & { requestId?: string };

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
    RUNTIME_ENDPOINT_INVALID: ["عنوان AI لا يشير إلى بوابة GameVortex الصحيحة. استخدم عنوان البوابة الذي ينتهي بمسار الخدمة الأساسي.", "The AI URL does not point to a compatible GameVortex gateway."],
    RUNTIME_HTTP_ERROR: ["أعاد خادم AI خطأ. افحص سجلات بوابة GameVortex AI وOllama.", "The AI runtime returned an error. Check the GameVortex AI gateway and Ollama logs."],
    RUNTIME_INVALID_RESPONSE: ["أرسل خادم AI استجابة غير مفهومة. تأكد أن العنوان يشير إلى بوابة Ollama المتوافقة.", "The AI runtime returned an invalid response. Check that the URL points to the compatible Ollama gateway."],
    RUNTIME_STREAM_FAILED: ["انقطع التوليد قبل اكتماله. تحقق من اتصال خادم AI ثم أعد المحاولة.", "Generation stopped before it finished. Check the AI runtime connection and try again."],
    RUNTIME_EMPTY_RESPONSE: ["لم يُرجع النموذج أي نص. تحقق من سجل النموذج ثم أعد المحاولة.", "The model returned no text. Check the model logs and try again."],
    REGENERATION_NOT_AVAILABLE: ["لا توجد إجابة أخيرة صالحة لإعادة توليدها. حدّث سجل المحادثة وحاول مرة أخرى.", "There is no latest answer available to regenerate. Refresh the conversation and try again."],
    CONVERSATION_NOT_FOUND: ["لم يتم العثور على المحادثة.", "Conversation not found."],
    UNAUTHORIZED: ["انتهت جلسة الدخول. سجّل الدخول مجددًا.", "Your session has expired. Sign in again."],
    DATABASE_UNAVAILABLE: ["تعذر حفظ المحادثة في قاعدة البيانات. تحقق من اتصال قاعدة البيانات ثم أعد المحاولة.", "The conversation could not be saved to the database. Check the database connection and try again."],
    AI_SERVICE_UNAVAILABLE: ["تعذر إكمال الطلب. تحقق من إعدادات خادم AI وقاعدة البيانات، ثم أعد المحاولة.", "The request could not be completed. Check the AI runtime and database, then try again."],
  };
  return messages[code]?.[english ? 1 : 0] || messages.AI_SERVICE_UNAVAILABLE[english ? 1 : 0];
}

export default function AiHubClient() {
  const english = useLocale() === "en";
  const [items, setItems] = useState<Conversation[]>([]);
  const [active, setActive] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const aborter = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const t = (ar: string, en: string) => english ? en : ar;

  async function refresh() {
    try {
      const response = await fetch("/api/gamevortex-ai/conversations");
      if (!response.ok) throw new Error("AI_SERVICE_UNAVAILABLE");
      const result = await response.json();
      setItems(Array.isArray(result.data) ? result.data : []);
    } catch {
      setError(errorMessage("AI_SERVICE_UNAVAILABLE", english));
    }
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
    } catch {
      setError(errorMessage("AI_SERVICE_UNAVAILABLE", english));
    }
  }

  async function create() {
    try {
      const response = await fetch("/api/gamevortex-ai/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok) {
        setError(errorMessage(response.status === 401 ? "UNAUTHORIZED" : "AI_SERVICE_UNAVAILABLE", english));
        return;
      }
      const { data } = await response.json();
      await refresh();
      await open(data.id);
    } catch {
      setError(errorMessage("AI_SERVICE_UNAVAILABLE", english));
    }
  }

  async function remove(id: string) {
    try {
      const response = await fetch(`/api/gamevortex-ai/conversations/${id}`, { method: "DELETE" });
      if (!response.ok) {
        setError(errorMessage(response.status === 401 ? "UNAUTHORIZED" : "AI_SERVICE_UNAVAILABLE", english));
        return;
      }
      setItems((current) => current.filter((item) => item.id !== id));
      if (active === id) {
        setActive("");
        setMessages([]);
      }
    } catch {
      setError(errorMessage("AI_SERVICE_UNAVAILABLE", english));
    }
  }

  async function rename(item: Conversation) {
    const title = window.prompt(t("اسم المحادثة", "Conversation title"), item.title);
    if (!title?.trim()) return;
    try {
      const response = await fetch(`/api/gamevortex-ai/conversations/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!response.ok) {
        setError(errorMessage("AI_SERVICE_UNAVAILABLE", english));
        return;
      }
      await refresh();
    } catch {
      setError(errorMessage("AI_SERVICE_UNAVAILABLE", english));
    }
  }

  useEffect(() => { void refresh(); }, []);
  useEffect(() => bottom.current?.scrollIntoView({ behavior: "smooth" }), [messages]);

  async function send(text = prompt, regenerate = false) {
    if (!text.trim() || busy) return;
    setError("");
    let conversationId = active;
    if (!conversationId) {
      let response: Response;
      try {
        response = await fetch("/api/gamevortex-ai/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
      } catch {
        setError(errorMessage("AI_SERVICE_UNAVAILABLE", english));
        return;
      }
      if (!response.ok) {
        setError(errorMessage(response.status === 401 ? "UNAUTHORIZED" : "AI_SERVICE_UNAVAILABLE", english));
        return;
      }
      const { data } = await response.json();
      conversationId = data.id;
      setActive(conversationId);
    }

    const previousMessages = messages;
    const userMessage: Message = { role: "user", content: text.trim() };
    const assistant: Message = { role: "assistant", content: "" };
    if (regenerate) setMessages((current) => [...current.slice(0, -1), assistant]);
    else setMessages((current) => [...current, userMessage, assistant]);
    setPrompt("");
    setBusy(true);
    const controller = new AbortController();
    aborter.current = controller;
    let activeRequestId: string | undefined;

    try {
      const response = await fetch("/api/gamevortex-ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, prompt: text.trim(), regenerate }),
        signal: controller.signal,
      });
      activeRequestId = response.headers.get("x-request-id") || undefined;
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const requestError = new Error(body.error || `HTTP_${response.status}`) as AiRequestError;
        requestError.requestId = body.requestId || activeRequestId;
        throw requestError;
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("RUNTIME_INVALID_RESPONSE");
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const piece = decoder.decode(value, { stream: true });
        assistant.content += piece;
        setMessages((current) => [...current.slice(0, -1), { ...assistant }]);
      }
      const finalPiece = decoder.decode();
      if (finalPiece) {
        assistant.content += finalPiece;
        setMessages((current) => [...current.slice(0, -1), { ...assistant }]);
      }
      await refresh();
    } catch (caught) {
      const aborted = controller.signal.aborted || (caught instanceof Error && caught.name === "AbortError");
      setMessages(previousMessages);
      if (!aborted) {
        const requestError = caught as AiRequestError;
        const code = requestError instanceof Error ? requestError.message : "AI_SERVICE_UNAVAILABLE";
        const referenceId = requestError.requestId || activeRequestId;
        const reference = referenceId ? ` (${t("مرجع الطلب", "Request reference")}: ${referenceId})` : "";
        setError(`${errorMessage(code, english)}${reference}`);
      }
    } finally {
      setBusy(false);
      aborter.current = null;
    }
  }

  async function editInstructions() {
    if (!active) return;
    try {
      const response = await fetch(`/api/gamevortex-ai/conversations/${active}`);
      if (!response.ok) {
        setError(errorMessage(response.status === 401 ? "UNAUTHORIZED" : "AI_SERVICE_UNAVAILABLE", english));
        return;
      }
      const current = await response.json();
      const value = window.prompt(t("تعليمات المحادثة", "Conversation instructions"), current.data?.systemInstructions || "");
      if (value === null) return;
      const saved = await fetch(`/api/gamevortex-ai/conversations/${active}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemInstructions: value }),
      });
      if (!saved.ok) setError(errorMessage("AI_SERVICE_UNAVAILABLE", english));
    } catch {
      setError(errorMessage("AI_SERVICE_UNAVAILABLE", english));
    }
  }

  return <main className={styles.aiHub} dir={english ? "ltr" : "rtl"} lang={english ? "en" : "ar"}>
    <header className={styles.header}>
      <div>
        <span className={styles.kicker}>GAMEVORTEX AI</span>
        <h1>{t("مساعد الألعاب المحلي", "Self-hosted gaming assistant")}</h1>
        <p>{t("تُعالج المحادثة على محركك المستضاف ذاتيًا. لا يوجد رد بديل عند غياب المحرك.", "Conversations run on your self-hosted runtime. No fallback responses are generated.")}</p>
      </div>
      <div>
        <button className={styles.primaryButton} disabled={busy} onClick={() => void create()}>＋ {t("محادثة جديدة", "New chat")}</button>
        {active && <button className={styles.primaryButton} disabled={busy} onClick={() => void editInstructions()}>{t("التعليمات", "Instructions")}</button>}
      </div>
    </header>

    <section className={styles.workArea}>
      <aside className={styles.sidebar}>
        <h3>{t("سجل المحادثات", "Conversation history")}</h3>
        {items.map((item) => <div className={styles.historyRow} key={item.id}>
          <button disabled={busy} onClick={() => void open(item.id)}>{item.title}</button>
          <button disabled={busy} aria-label={t("إعادة تسمية", "Rename")} onClick={() => void rename(item)}>✎</button>
          <button disabled={busy} aria-label={t("حذف", "Delete")} onClick={() => void remove(item.id)}>×</button>
        </div>)}
      </aside>

      <div className={styles.chatPanel}>
        <div className={styles.messages}>
          {messages.length === 0 && <div className={styles.welcome}>
            <h2>{t("اسأل عن الألعاب", "Ask about games")}</h2>
            <p>{t("ستظهر الإجابة عند اتصال محرك نموذج محلي.", "Replies appear when a self-hosted model runtime is connected.")}</p>
          </div>}
          {messages.map((message, index) => <article key={message.id || index} className={`${styles.message} ${message.role === "user" ? styles.userMessage : styles.aiMessage}`} dir="auto">
            <strong>{message.role === "user" ? t("أنت", "You") : "GameVortex AI"}</strong>
            <div className={styles.markdown}>{message.content.split(/```/).map((block, blockIndex) => blockIndex % 2
              ? <pre key={blockIndex}><code>{block.replace(/^\w*\n/, "")}</code></pre>
              : <p key={blockIndex}>{inlineMarkdown(block)}</p>)}</div>
            {message.content && <button onClick={() => void navigator.clipboard.writeText(message.content)}>{t("نسخ", "Copy")}</button>}
          </article>)}
          <div ref={bottom} />
        </div>

        {busy && <p className={styles.status} role="status">{t("جارٍ توليد الرد...", "Generating response...")}</p>}
        {error && <p role="alert" className={styles.notice}>{error}</p>}
        <form className={styles.composer} onSubmit={(event) => { event.preventDefault(); void send(); }}>
          <textarea dir="auto" value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={6000} rows={2} placeholder={t("اكتب رسالتك...", "Write a message...")} />
          <button disabled={busy || !prompt.trim()}>{t("إرسال", "Send")}</button>
          {busy && <button type="button" onClick={() => aborter.current?.abort()}>{t("إيقاف", "Stop")}</button>}
          {messages.at(-1)?.role === "assistant" && !busy && <button type="button" onClick={() => {
            const previousUser = [...messages].reverse().find((message) => message.role === "user")?.content;
            if (previousUser) void send(previousUser, true);
          }}>{t("إعادة التوليد", "Regenerate")}</button>}
        </form>
      </div>
    </section>
  </main>;
}
