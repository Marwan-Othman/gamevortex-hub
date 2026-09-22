"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

type MessageRole =
  | "USER"
  | "ASSISTANT"
  | "user"
  | "assistant";

type MessageStatus =
  | "PENDING"
  | "STREAMING"
  | "COMPLETE"
  | "STOPPED"
  | "ERROR";

type Message = {
  id?: string;
  role: MessageRole;
  status?: MessageStatus;
  content: string;
  createdAt?: string;
  updatedAt?: string;
};

type Conversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  _count?: {
    messages: number;
  };
};

type StreamEvent =
  | {
      type: "meta";
      conversationId?: string;
      assistantMessageId?: string;
    }
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

const WELCOME_MESSAGE: Message = {
  role: "assistant",
  content:
    "مرحبًا بك في GameVortex AI 🎮\nأنا مساعدك الذكي داخل GameVortex Hub. كيف يمكنني مساعدتك؟",
};

function normalizeRole(role: MessageRole): "user" | "assistant" {
  return role === "USER" || role === "user"
    ? "user"
    : "assistant";
}

function isAssistantMessage(message: Message) {
  return normalizeRole(message.role) === "assistant";
}

async function copyTextToClipboard(text: string) {
  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    window.isSecureContext
  ) {
    await navigator.clipboard.writeText(text);
    return;
  }

  /*
   * Fallback for browsers/environments where the
   * Clipboard API is unavailable.
   */
  const textarea = document.createElement("textarea");

  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";

  document.body.appendChild(textarea);

  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  const copied = document.execCommand("copy");

  document.body.removeChild(textarea);

  if (!copied) {
    throw new Error("COPY_FAILED");
  }
}

export default function AIChat() {
  const [messages, setMessages] = useState<Message[]>([
    WELCOME_MESSAGE,
  ]);

  const [input, setInput] = useState("");

  const [loading, setLoading] = useState(false);

  const [stopping, setStopping] = useState(false);

  const [conversations, setConversations] = useState<
    Conversation[]
  >([]);

  const [conversationId, setConversationId] = useState<
    string | null
  >(null);

  const [historyLoading, setHistoryLoading] = useState(false);

  const [historyOpen, setHistoryOpen] = useState(false);

  const [copiedMessageId, setCopiedMessageId] = useState<
    string | null
  >(null);

  const abortControllerRef =
    useRef<AbortController | null>(null);

  const assistantMessageIdRef =
    useRef<string | null>(null);

  const stoppedRef = useRef(false);

  const copyTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(
      null,
    );

  const messagesEndRef =
    useRef<HTMLDivElement | null>(null);

  /*
   * Keep the chat scrolled to the newest message.
   */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end",
    });
  }, [messages, loading]);

  /*
   * Cleanup timers/controllers when the component
   * is unmounted.
   */
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();

      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  /*
   * Load conversation history.
   */
  const loadConversations =
    useCallback(async () => {
      try {
        setHistoryLoading(true);

        const response =
          await fetch(
            "/api/ai/conversations",
            {
              method: "GET",
              cache: "no-store",
            },
          );

        if (!response.ok) {
          return;
        }

        const data =
          await response.json();

        if (
          Array.isArray(data?.data)
        ) {
          setConversations(
            data.data as Conversation[],
          );
        }
      } catch {
        /*
         * History is secondary UI.
         * Do not break the chat if history
         * cannot be loaded.
         */
      } finally {
        setHistoryLoading(false);
      }
    }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  /*
   * Create a new conversation on the server.
   */
  async function createConversation() {
    const response =
      await fetch(
        "/api/ai/conversations",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            title: "New Chat",
          }),
        },
      );

    const data =
      await response.json();

    if (
      !response.ok ||
      !data?.data?.id
    ) {
      throw new Error(
        typeof data?.error === "string"
          ? data.error
          : "AI_CONVERSATION_CREATE_FAILED",
      );
    }

    return data.data as Conversation;
  }

  /*
   * Start a completely new chat.
   */
  async function startNewChat() {
    if (loading || stopping) {
      return;
    }

    setMessages([WELCOME_MESSAGE]);
    setConversationId(null);
    setInput("");
    setCopiedMessageId(null);
    setHistoryOpen(false);

    /*
     * We intentionally do not create an empty database
     * conversation here. It will be created when the
     * user actually sends the first message.
     */
  }

  /*
   * Load one conversation including its messages.
   */
  async function loadConversation(
    id: string,
  ) {
    if (loading || stopping) {
      return;
    }

    try {
      setHistoryLoading(true);

      const response =
        await fetch(
          `/api/ai/conversations/${encodeURIComponent(
            id,
          )}`,
          {
            method: "GET",
            cache: "no-store",
          },
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          typeof data?.error === "string"
            ? data.error
            : "CONVERSATION_LOAD_FAILED",
        );
      }

      const conversation =
        data?.data;

      if (!conversation) {
        throw new Error(
          "CONVERSATION_LOAD_FAILED",
        );
      }

      const loadedMessages =
        Array.isArray(
          conversation.messages,
        )
          ? conversation.messages.map(
              (
                message: Message,
              ) => ({
                id: message.id,
                role: message.role,
                status:
                  message.status,
                content:
                  message.content,
                createdAt:
                  message.createdAt,
                updatedAt:
                  message.updatedAt,
              }),
            )
          : [];

      setConversationId(
        conversation.id,
      );

      setMessages(
        loadedMessages.length > 0
          ? loadedMessages
          : [WELCOME_MESSAGE],
      );

      setCopiedMessageId(null);
      setHistoryOpen(false);
    } catch (error) {
      console.error(
        "AI_CONVERSATION_LOAD_ERROR",
        error,
      );
    } finally {
      setHistoryLoading(false);
    }
  }

  /*
   * Copy a complete assistant response.
   *
   * This does not modify the message itself.
   */
  async function copyMessage(
    message: Message,
    messageKey: string,
  ) {
    const content =
      message.content;

    if (!content.trim()) {
      return;
    }

    try {
      await copyTextToClipboard(
        content,
      );

      setCopiedMessageId(
        messageKey,
      );

      if (copyTimerRef.current) {
        clearTimeout(
          copyTimerRef.current,
        );
      }

      copyTimerRef.current =
        setTimeout(() => {
          setCopiedMessageId(null);
        }, 1600);
    } catch (error) {
      console.error(
        "AI_COPY_ERROR",
        error,
      );

      setCopiedMessageId(null);
    }
  }

  /*
   * Stop the currently running generation.
   */
  async function stopGeneration() {
    if (
      !loading ||
      stopping
    ) {
      return;
    }

    setStopping(true);
    stoppedRef.current = true;

    const messageId =
      assistantMessageIdRef.current;

    /*
     * Immediately update the UI so the user does not
     * have to stare at a spinning button while the
     * server catches up.
     */
    setMessages(
      (current) => {
        const updated = [
          ...current,
        ];

        for (
          let index =
            updated.length - 1;
          index >= 0;
          index -= 1
        ) {
          const message =
            updated[index];

          if (
            isAssistantMessage(
              message,
            ) &&
            message.id ===
              messageId
          ) {
            updated[index] = {
              ...message,
              status:
                "STOPPED",
            };

            break;
          }
        }

        return updated;
      },
    );

    /*
     * Tell the server to mark the assistant message
     * as STOPPED.
     */
    if (messageId) {
      try {
        await fetch(
          `/api/ai/messages/${encodeURIComponent(
            messageId,
          )}`,
          {
            method: "PATCH",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              action: "stop",
            }),
          },
        );
      } catch (error) {
        console.error(
          "AI_MESSAGE_STOP_ERROR",
          error,
        );
      }
    }

    /*
     * Abort the browser-side streaming request.
     */
    abortControllerRef.current?.abort();
    abortControllerRef.current =
      null;

    setLoading(false);
    setStopping(false);
  }

  async function sendMessage(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const text =
      input.trim();

    if (
      !text ||
      loading ||
      stopping
    ) {
      return;
    }

    stoppedRef.current = false;
    assistantMessageIdRef.current =
      null;

    setCopiedMessageId(null);

    const userMessage: Message = {
      role: "user",
      content: text,
      status: "COMPLETE",
    };

    setMessages(
      (current) => [
        ...current,
        userMessage,
      ],
    );

    setInput("");
    setLoading(true);
    setStopping(false);

    /*
     * Create a conversation only when the user
     * actually sends the first message.
     */
    let activeConversationId =
      conversationId;

    try {
      if (!activeConversationId) {
        const conversation =
          await createConversation();

        activeConversationId =
          conversation.id;

        setConversationId(
          conversation.id,
        );
      }

      /*
       * Assistant placeholder.
       */
      setMessages(
        (current) => [
          ...current,
          {
            role: "assistant",
            content: "",
            status: "STREAMING",
          },
        ],
      );

      const controller =
        new AbortController();

      abortControllerRef.current =
        controller;

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
            body: JSON.stringify({
              message: text,
              stream: true,
              conversationId:
                activeConversationId,
            }),
            signal:
              controller.signal,
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
              details?: string;
            }
          | null = null;

        try {
          data =
            await response.json();
        } catch {
          data = null;
        }

        const publicError =
          typeof data?.error ===
          "string"
            ? data.error
            : "حدث خطأ أثناء الاتصال بالمساعد الذكي.";

        const details =
          typeof data?.details ===
          "string"
            ? data.details
            : "";

        throw new Error(
          details
            ? `${publicError}: ${details}`
            : publicError,
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

          /*
           * The server sends the database IDs once
           * the assistant message has been created.
           */
          if (
            eventData.type ===
            "meta"
          ) {
            if (
              eventData
                .conversationId
            ) {
              activeConversationId =
                eventData.conversationId;

              setConversationId(
                eventData.conversationId,
              );
            }

            if (
              eventData
                .assistantMessageId
            ) {
              assistantMessageIdRef.current =
                eventData.assistantMessageId;

              setMessages(
                (current) => {
                  const updated = [
                    ...current,
                  ];

                  for (
                    let index =
                      updated.length -
                      1;
                    index >= 0;
                    index -= 1
                  ) {
                    if (
                      isAssistantMessage(
                        updated[
                          index
                        ],
                      ) &&
                      !updated[
                        index
                      ].id
                    ) {
                      updated[
                        index
                      ] = {
                        ...updated[
                          index
                        ],
                        id:
                          eventData.assistantMessageId,
                      };

                      break;
                    }
                  }

                  return updated;
                },
              );
            }
          }

          if (
            eventData.type ===
            "delta"
          ) {
            const delta =
              eventData.text;

            if (
              stoppedRef.current
            ) {
              continue;
            }

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
                  !isAssistantMessage(
                    last,
                  )
                ) {
                  return current;
                }

                updated[
                  lastIndex
                ] = {
                  ...last,
                  status:
                    "STREAMING",
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

            setMessages(
              (current) => {
                const updated =
                  [...current];

                for (
                  let index =
                    updated.length -
                    1;
                  index >= 0;
                  index -= 1
                ) {
                  if (
                    isAssistantMessage(
                      updated[
                        index
                      ],
                    )
                  ) {
                    updated[
                      index
                    ] = {
                      ...updated[
                        index
                      ],
                      status:
                        "COMPLETE",
                    };

                    break;
                  }
                }

                return updated;
              },
            );

            break;
          }
        }
      }

      /*
       * If the stream ended normally without a done event,
       * do not overwrite a message that the user intentionally
       * stopped.
       */
      if (
        !stoppedRef.current
      ) {
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
              isAssistantMessage(
                last,
              ) &&
              !last.content.trim()
            ) {
              updated[
                lastIndex
              ] = {
                ...last,
                status:
                  "ERROR",
                content:
                  "لم يصل رد من GameVortex AI.",
              };
            }

            return updated;
          },
        );
      }

      await loadConversations();
    } catch (error) {
      /*
       * Abort caused by the Stop button is expected.
       * It is not an AI error.
       */
      if (
        error instanceof DOMException &&
        error.name ===
          "AbortError"
      ) {
        return;
      }

      if (
        stoppedRef.current
      ) {
        return;
      }

      const errorMessage =
        error instanceof Error
          ? error.message
          : "حدث خطأ غير متوقع.";

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
            isAssistantMessage(
              last,
            ) &&
            !last.content.trim()
          ) {
            updated[
              lastIndex
            ] = {
              ...last,
              status:
                "ERROR",
              content:
                `تعذر تنفيذ الطلب: ${errorMessage}`,
            };
          }

          return updated;
        },
      );
    } finally {
      abortControllerRef.current =
        null;
      setLoading(false);
      setStopping(false);

      /*
       * Refresh history after every completed request
       * so titles/message counts remain current.
       */
      void loadConversations();
    }
  }

  return (
    <section className="glass card gv-ai-shell">
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
          <span
            className={`ai-status-dot ${
              loading
                ? "ai-status-dot-active"
                : ""
            }`}
          />

          <span>
            {stopping
              ? "جارٍ الإيقاف"
              : loading
                ? "جاري التوليد"
                : "متاح"}
          </span>
        </div>
      </div>

      <div className="gv-ai-toolbar">
        <button
          type="button"
          className="gv-ai-history-button"
          onClick={() =>
            setHistoryOpen(
              (current) =>
                !current,
            )
          }
          disabled={
            loading ||
            stopping
          }
        >
          ☰{" "}
          {historyOpen
            ? "إغلاق السجل"
            : "المحادثات"}
        </button>

        <button
          type="button"
          className="gv-ai-new-chat"
          onClick={
            startNewChat
          }
          disabled={
            loading ||
            stopping
          }
        >
          ＋ محادثة جديدة
        </button>
      </div>

      {historyOpen && (
        <aside className="gv-ai-history">
          <div className="gv-ai-history-header">
            <strong>
              سجل المحادثات
            </strong>

            <button
              type="button"
              className="gv-ai-history-close"
              onClick={() =>
                setHistoryOpen(
                  false,
                )
              }
              aria-label="إغلاق سجل المحادثات"
            >
              ×
            </button>
          </div>

          {historyLoading ? (
            <div className="gv-ai-history-empty">
              جاري تحميل المحادثات...
            </div>
          ) : conversations.length ===
            0 ? (
            <div className="gv-ai-history-empty">
              لا توجد محادثات محفوظة بعد.
            </div>
          ) : (
            <div className="gv-ai-history-list">
              {conversations.map(
                (
                  conversation,
                ) => (
                  <button
                    type="button"
                    key={
                      conversation.id
                    }
                    className={`gv-ai-history-item ${
                      conversationId ===
                      conversation.id
                        ? "active"
                        : ""
                    }`}
                    onClick={() =>
                      void loadConversation(
                        conversation.id,
                      )
                    }
                    disabled={
                      loading ||
                      stopping ||
                      historyLoading
                    }
                  >
                    <span className="gv-ai-history-title">
                      {conversation.title ||
                        "New Chat"}
                    </span>

                    <span className="gv-ai-history-count">
                      {conversation
                        ._count
                        ?.messages ??
                        0}{" "}
                      رسالة
                    </span>
                  </button>
                ),
              )}
            </div>
          )}
        </aside>
      )}

      <div className="ai-chat-messages">
        {messages.map(
          (
            message,
            index,
          ) => {
            const role =
              normalizeRole(
                message.role,
              );

            const isAssistant =
              role ===
              "assistant";

            const messageKey =
              message.id ??
              `${role}-${index}`;

            const isCopied =
              copiedMessageId ===
              messageKey;

            const isStopped =
              message.status ===
              "STOPPED";

            return (
              <div
                key={
                  messageKey
                }
                className={`ai-message ${
                  role ===
                  "user"
                    ? "ai-message-user"
                    : "ai-message-assistant"
                }`}
              >
                <div className="ai-message-role">
                  {role ===
                  "user"
                    ? "أنت"
                    : "GameVortex AI"}
                </div>

                <div className="ai-message-content">
                  {message.content}
                </div>

                {isAssistant &&
                  message.content.trim() && (
                    <div className="gv-ai-message-actions">
                      <button
                        type="button"
                        className={`gv-ai-copy ${
                          isCopied
                            ? "copied"
                            : ""
                        }`}
                        onClick={() =>
                          void copyMessage(
                            message,
                            messageKey,
                          )
                        }
                        aria-label={
                          isCopied
                            ? "تم نسخ الرد"
                            : "نسخ رد GameVortex AI"
                        }
                      >
                        {isCopied
                          ? "✓ تم النسخ"
                          : "⧉ نسخ"}
                      </button>
                    </div>
                  )}

                {isStopped && (
                  <div className="gv-ai-stopped">
                    ⏹ تم إيقاف التوليد
                  </div>
                )}
              </div>
            );
          },
        )}

        {loading &&
          !stopping && (
            <div className="ai-message ai-message-assistant">
              <div className="ai-message-role">
                GameVortex AI
              </div>

              <div className="ai-message-content">
                جاري التفكير...
              </div>
            </div>
          )}

        {stopping && (
          <div className="ai-message ai-message-assistant">
            <div className="ai-message-role">
              GameVortex AI
            </div>

            <div className="ai-message-content">
              جارٍ إيقاف التوليد...
            </div>
          </div>
        )}

        <div
          ref={
            messagesEndRef
          }
        />
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
              event.target.value,
            )
          }
          placeholder="اكتب رسالتك هنا..."
          rows={3}
          disabled={
            loading ||
            stopping
          }
          maxLength={4000}
        />

        {loading ? (
          <button
            type="button"
            className="btn gv-ai-stop"
            onClick={
              stopGeneration
            }
            disabled={
              stopping
            }
          >
            {stopping
              ? "جارٍ الإيقاف..."
              : "⏹ إيقاف"}
          </button>
        ) : (
          <button
            type="submit"
            disabled={
              !input.trim() ||
              stopping
            }
            className="btn"
          >
            إرسال
          </button>
        )}
      </form>

      <style jsx>{`
        .gv-ai-shell {
          position: relative;
          width: 100%;
        }

        .gv-ai-toolbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin: 16px 0;
          flex-wrap: wrap;
        }

        .gv-ai-history-button,
        .gv-ai-new-chat,
        .gv-ai-history-close,
        .gv-ai-copy {
          appearance: none;
          border: 1px solid rgba(255, 255, 255, 0.12);
          background: rgba(255, 255, 255, 0.045);
          color: #e2e8f0;
          cursor: pointer;
          transition:
            background 0.2s ease,
            border-color 0.2s ease,
            transform 0.2s ease;
        }

        .gv-ai-history-button,
        .gv-ai-new-chat {
          min-height: 42px;
          padding: 0 15px;
          border-radius: 12px;
          font-weight: 800;
        }

        .gv-ai-history-button:hover,
        .gv-ai-new-chat:hover,
        .gv-ai-copy:hover {
          border-color: rgba(
            34,
            211,
            238,
            0.45
          );
          background: rgba(
            34,
            211,
            238,
            0.08
          );
          transform: translateY(
            -1px
          );
        }

        .gv-ai-new-chat {
          color: #fff;
          border-color: rgba(
            168,
            85,
            247,
            0.35
          );
          background: rgba(
            124,
            58,
            237,
            0.14
          );
        }

        .gv-ai-history-button:disabled,
        .gv-ai-new-chat:disabled,
        .gv-ai-copy:disabled {
          opacity: 0.55;
          cursor: not-allowed;
          transform: none;
        }

        .gv-ai-history {
          margin-bottom: 16px;
          padding: 14px;
          border: 1px solid
            rgba(255, 255, 255, 0.1);
          border-radius: 16px;
          background: rgba(
            7,
            10,
            24,
            0.7
          );
          backdrop-filter: blur(16px);
        }

        .gv-ai-history-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 10px;
        }

        .gv-ai-history-close {
          width: 34px;
          height: 34px;
          border-radius: 9px;
          font-size: 20px;
          line-height: 1;
        }

        .gv-ai-history-list {
          display: grid;
          gap: 8px;
          max-height: 280px;
          overflow-y: auto;
        }

        .gv-ai-history-item {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 11px 12px;
          border: 1px solid
            rgba(255, 255, 255, 0.07);
          border-radius: 11px;
          background: rgba(
            255,
            255,
            255,
            0.025
          );
          color: #e2e8f0;
          text-align: start;
          cursor: pointer;
        }

        .gv-ai-history-item:hover,
        .gv-ai-history-item.active {
          border-color: rgba(
            124,
            58,
            237,
            0.5
          );
          background: rgba(
            124,
            58,
            237,
            0.12
          );
        }

        .gv-ai-history-title {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-weight: 700;
        }

        .gv-ai-history-count {
          flex: 0 0 auto;
          color: rgba(
            226,
            232,
            240,
            0.5
          );
          font-size: 11px;
        }

        .gv-ai-history-empty {
          padding: 18px 8px;
          color: rgba(
            226,
            232,
            240,
            0.58
          );
          text-align: center;
        }

        .gv-ai-message-actions {
          display: flex;
          align-items: center;
          justify-content: flex-start;
          margin-top: 9px;
        }

        .gv-ai-copy {
          min-height: 31px;
          padding: 0 10px;
          border-radius: 8px;
          font-size: 12px;
          font-weight: 800;
        }

        .gv-ai-copy.copied {
          border-color: rgba(
            34,
            197,
            94,
            0.45
          );
          background: rgba(
            34,
            197,
            94,
            0.1
          );
        }

        .gv-ai-stopped {
          margin-top: 8px;
          color: rgba(
            251,
            191,
            36,
            0.9
          );
          font-size: 12px;
          font-weight: 700;
        }

        .ai-status-dot-active {
          animation: gvAiPulse 1.2s
            ease-in-out infinite;
        }

        @keyframes gvAiPulse {
          0%,
          100% {
            opacity: 0.45;
            transform: scale(0.9);
          }

          50% {
            opacity: 1;
            transform: scale(1.15);
          }
        }

        @media (max-width: 700px) {
          .gv-ai-toolbar {
            display: grid;
            grid-template-columns: 1fr 1fr;
          }

          .gv-ai-history-button,
          .gv-ai-new-chat {
            width: 100%;
            min-width: 0;
          }

          .gv-ai-history {
            padding: 11px;
          }

          .gv-ai-history-item {
            align-items: flex-start;
            flex-direction: column;
            gap: 5px;
          }

          .gv-ai-history-count {
            font-size: 10px;
          }

          .gv-ai-copy {
            min-height: 34px;
            padding: 0 11px;
          }
        }

        @media (max-width: 420px) {
          .gv-ai-toolbar {
            grid-template-columns: 1fr;
          }

          .gv-ai-copy {
            min-height: 36px;
          }
        }
      `}</style>
    </section>
  );
}
