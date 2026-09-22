"use client";

import { FormEvent, useState } from "react";

type Message = {
  role: "user" | "assistant";
  content: string;
};

export default function AIChat() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "مرحبًا بك في GameVortex AI 🎮\nأنا مساعدك الذكي داخل GameVortex Hub. كيف يمكنني مساعدتك؟",
    },
  ]);

  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const text = input.trim();

    if (!text || loading) {
      return;
    }

    const userMessage: Message = {
      role: "user",
      content: text,
    };

    setMessages((current) => [...current, userMessage]);
    setInput("");
    setLoading(true);

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: text,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : "حدث خطأ أثناء الاتصال بالمساعد الذكي.",
        );
      }

      const assistantMessage: Message = {
        role: "assistant",
        content:
          typeof data?.message === "string"
            ? data.message
            : typeof data?.content === "string"
              ? data.content
              : "لم أتمكن من الحصول على رد من المساعد.",
      };

      setMessages((current) => [
        ...current,
        assistantMessage,
      ]);
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "حدث خطأ غير متوقع.";

      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: `تعذر تنفيذ الطلب: ${errorMessage}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="glass card">
      <div className="ai-chat-header">
        <div>
          <span className="badge">GAMEVORTEX AI</span>

          <h2>المساعد الذكي</h2>

          <p className="muted">
            مساعدك الذكي داخل GameVortex Hub
          </p>
        </div>

        <div className="ai-status">
          <span className="ai-status-dot" />
          <span>متاح</span>
        </div>
      </div>

      <div className="ai-chat-messages">
        {messages.map((message, index) => (
          <div
            key={`${message.role}-${index}`}
            className={`ai-message ${
              message.role === "user"
                ? "ai-message-user"
                : "ai-message-assistant"
            }`}
          >
            <div className="ai-message-role">
              {message.role === "user"
                ? "أنت"
                : "GameVortex AI"}
            </div>

            <div className="ai-message-content">
              {message.content}
            </div>
          </div>
        ))}

        {loading && (
          <div className="ai-message ai-message-assistant">
            <div className="ai-message-role">
              GameVortex AI
            </div>

            <div className="ai-message-content">
              جاري التفكير...
            </div>
          </div>
        )}
      </div>

      <form
        onSubmit={sendMessage}
        className="ai-chat-form"
      >
        <textarea
          value={input}
          onChange={(event) =>
            setInput(event.target.value)
          }
          placeholder="اكتب رسالتك هنا..."
          rows={3}
          disabled={loading}
          maxLength={4000}
        />

        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="btn"
        >
          {loading
            ? "جاري الإرسال..."
            : "إرسال"}
        </button>
      </form>
    </section>
  );
}
