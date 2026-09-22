"use client";

import {
  FormEvent,
  useState,
} from "react";

type Message = {
  role:
    | "user"
    | "assistant";
  content: string;
};

type StreamEvent =
  | {
      type: "delta";
      text: string;
    }
  | {
      type: "done";
      idempotencyKey?: string;
      provider?: string;
    }
  | {
      type: "error";
      error?: string;
    };

export default function AIChat() {
  const [messages, setMessages] =
    useState<Message[]>([
      {
        role: "assistant",
        content:
          "مرحبًا بك في GameVortex AI 🎮\nأنا مساعدك الذكي داخل GameVortex Hub. كيف يمكنني مساعدتك؟",
      },
    ]);

  const [input, setInput] =
    useState("");

  const [loading, setLoading] =
    useState(false);

  async function sendMessage(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const text =
      input.trim();

    if (
      !text ||
      loading
    ) {
      return;
    }

    const userMessage: Message = {
      role: "user",
      content: text,
    };

    setMessages(
      (current) => [
        ...current,
        userMessage,
      ],
    );

    setInput("");
    setLoading(true);

    /*
     * Add an empty assistant message immediately.
     * Streaming tokens will be appended to this message.
     */
    setMessages(
      (current) => [
        ...current,
        {
          role: "assistant",
          content: "",
        },
      ],
    );

    try {
      const response =
        await fetch(
          "/api/ai/chat",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
              Accept:
                "text/event-stream",
            },

            body:
              JSON.stringify({
                message: text,
                stream: true,
              }),
          },
        );

      /*
       * Authentication / validation / credit errors
       * happen before streaming starts, so they arrive
       * as normal JSON.
       */
      if (!response.ok) {
        let data:
          | {
              error?: string;
            }
          | null = null;

        try {
          data =
            await response.json();
        } catch {
          data = null;
        }

        throw new Error(
          typeof data?.error ===
            "string"
            ? data.error
            : "حدث خطأ أثناء الاتصال بالمساعد الذكي.",
        );
      }

      if (!response.body) {
        throw new Error(
          "لم يتم إنشاء اتصال Streaming.",
        );
      }

      const reader =
        response.body.getReader();

      const decoder =
        new TextDecoder();

      let buffer = "";
      let finished = false;

      while (!finished) {
        const {
          done,
          value,
        } =
          await reader.read();

        if (done) {
          break;
        }

        buffer +=
          decoder.decode(
            value,
            {
              stream: true,
            },
          );

        const events =
          buffer.split(
            "\n\n",
          );

        buffer =
          events.pop() ?? "";

        for (
          const eventBlock of events
        ) {
          const dataLine =
            eventBlock
              .split("\n")
              .find(
                (line) =>
                  line.startsWith(
                    "data:",
                  ),
              );

          if (!dataLine) {
            continue;
          }

          const raw =
            dataLine
              .slice(5)
              .trim();

          if (!raw) {
            continue;
          }

          let eventData:
            | StreamEvent
            | null = null;

          try {
            eventData =
              JSON.parse(
                raw,
              ) as StreamEvent;
          } catch {
            continue;
          }

          if (
            eventData.type ===
            "delta"
          ) {
            const delta =
              eventData.text;

            setMessages(
              (current) => {
                if (
                  current.length ===
                  0
                ) {
                  return current;
                }

                const updated =
                  [...current];

                const lastIndex =
                  updated.length -
                  1;

                const last =
                  updated[
                    lastIndex
                  ];

                if (
                  last.role !==
                  "assistant"
                ) {
                  return current;
                }

                updated[
                  lastIndex
                ] = {
                  ...last,
                  content:
                    last.content +
                    delta,
                };

                return updated;
              },
            );
          }

          if (
            eventData.type ===
            "error"
          ) {
            throw new Error(
              eventData.error ||
                "AI_STREAM_FAILED",
            );
          }

          if (
            eventData.type ===
            "done"
          ) {
            finished = true;
            break;
          }
        }
      }

      /*
       * If the server closed the stream without sending
       * any assistant content, show a useful error instead
       * of leaving an empty message in the chat.
       */
      setMessages(
        (current) => {
          if (
            current.length ===
            0
          ) {
            return current;
          }

          const updated =
            [...current];

          const lastIndex =
            updated.length -
            1;

          const last =
            updated[
              lastIndex
            ];

          if (
            last.role ===
              "assistant" &&
            !last.content.trim()
          ) {
            updated[
              lastIndex
            ] = {
              ...last,
              content:
                "لم يصل رد من GameVortex AI.",
            };
          }

          return updated;
        },
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "حدث خطأ غير متوقع.";

      /*
       * Remove the empty assistant placeholder if
       * streaming failed before any useful content arrived.
       */
      setMessages(
        (current) => {
          const updated =
            [...current];

          const lastIndex =
            updated.length -
            1;

          const last =
            updated[
              lastIndex
            ];

          if (
            last?.role ===
              "assistant" &&
            !last.content.trim()
          ) {
            updated[
              lastIndex
            ] = {
              ...last,
              content:
                `تعذر تنفيذ الطلب: ${errorMessage}`,
            };
          }

          return updated;
        },
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="glass card">
      <div className="ai-chat-header">
        <div>
          <span className="badge">
            GAMEVORTEX AI
          </span>

          <h2>
            المساعد الذكي
          </h2>

          <p className="muted">
            مساعدك الذكي داخل
            GameVortex Hub
          </p>
        </div>

        <div className="ai-status">
          <span className="ai-status-dot" />
          <span>
            متاح
          </span>
        </div>
      </div>

      <div className="ai-chat-messages">
        {messages.map(
          (
            message,
            index,
          ) => (
            <div
              key={`${message.role}-${index}`}
              className={`ai-message ${
                message.role ===
                "user"
                  ? "ai-message-user"
                  : "ai-message-assistant"
              }`}
            >
              <div className="ai-message-role">
                {message.role ===
                "user"
                  ? "أنت"
                  : "GameVortex AI"}
              </div>

              <div className="ai-message-content">
                {message.content}
              </div>
            </div>
          ),
        )}

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
        onSubmit={
          sendMessage
        }
        className="ai-chat-form"
      >
        <textarea
          value={input}
          onChange={(
            event,
          ) =>
            setInput(
              event.target
                .value,
            )
          }
          placeholder="اكتب رسالتك هنا..."
          rows={3}
          disabled={
            loading
          }
          maxLength={4000}
        />

        <button
          type="submit"
          disabled={
            loading ||
            !input.trim()
          }
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
