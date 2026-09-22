"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useState,
} from "react";

type MessageRole =
  | "user"
  | "assistant";

type Message = {
  id?: string;
  role: MessageRole;
  content: string;
  status?: string;
  createdAt?: string;
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
      type: "delta";
      text: string;
    }
  | {
      type: "done";
      idempotencyKey?: string;
      provider?: string;
      conversationId?: string;
      userMessageId?: string;
      assistantMessageId?: string;
    }
  | {
      type: "error";
      error?: string;
      conversationId?: string;
      userMessageId?: string;
      assistantMessageId?: string;
    };

type ApiConversationResponse = {
  success?: boolean;
  data?: Conversation[];
  error?: string;
};

type ApiConversationDetailResponse = {
  success?: boolean;
  data?: {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    messages: Array<{
      id: string;
      role:
        | "USER"
        | "ASSISTANT"
        | "SYSTEM";
      status: string;
      content: string;
      createdAt: string;
      updatedAt: string;
    }>;
  };
  error?: string;
};

const WELCOME_MESSAGE: Message = {
  role: "assistant",
  content:
    "مرحبًا بك في GameVortex AI 🎮\nأنا مساعدك الذكي داخل GameVortex Hub. كيف يمكنني مساعدتك؟",
};

function getConversationLabel(
  conversation: Conversation,
) {
  const title =
    conversation.title.trim();

  if (
    title &&
    title !== "New Chat"
  ) {
    return title;
  }

  return "محادثة جديدة";
}

function formatConversationDate(
  value: string,
) {
  try {
    const date =
      new Date(value);

    if (
      Number.isNaN(
        date.getTime(),
      )
    ) {
      return "";
    }

    return date.toLocaleDateString(
      "ar",
      {
        day: "numeric",
        month: "short",
      },
    );
  } catch {
    return "";
  }
}

export default function AIChat() {
  const [
    conversations,
    setConversations,
  ] = useState<
    Conversation[]
  >([]);

  const [
    currentConversationId,
    setCurrentConversationId,
  ] = useState<
    string | null
  >(null);

  const [
    messages,
    setMessages,
  ] = useState<Message[]>([
    WELCOME_MESSAGE,
  ]);

  const [
    input,
    setInput,
  ] = useState("");

  const [
    loading,
    setLoading,
  ] = useState(false);

  const [
    historyLoading,
    setHistoryLoading,
  ] = useState(false);

  const [
    conversationsLoading,
    setConversationsLoading,
  ] = useState(true);

  const [
    errorMessage,
    setErrorMessage,
  ] = useState<
    string | null
  >(null);

  /*
   * --------------------------------------------------
   * LOAD CONVERSATION LIST
   * --------------------------------------------------
   */
  const loadConversations =
    useCallback(
      async () => {
        setConversationsLoading(
          true,
        );

        try {
          const response =
            await fetch(
              "/api/ai/conversations",
              {
                method: "GET",
                cache: "no-store",
              },
            );

          if (!response.ok) {
            if (
              response.status ===
              401
            ) {
              setConversations([]);
              return;
            }

            throw new Error(
              "تعذر تحميل سجل المحادثات.",
            );
          }

          const data =
            (await response.json()) as ApiConversationResponse;

          if (
            !data.success ||
            !Array.isArray(
              data.data,
            )
          ) {
            throw new Error(
              "تعذر تحميل سجل المحادثات.",
            );
          }

          setConversations(
            data.data,
          );
        } catch (error) {
          console.error(
            "AI conversation history error:",
            error,
          );

          setErrorMessage(
            error instanceof
              Error
              ? error.message
              : "تعذر تحميل سجل المحادثات.",
          );
        } finally {
          setConversationsLoading(
            false,
          );
        }
      },
      [],
    );

  /*
   * Load the history once when the AI page opens.
   */
  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  /*
   * --------------------------------------------------
   * LOAD ONE CONVERSATION
   * --------------------------------------------------
   */
  const openConversation =
    useCallback(
      async (
        conversationId: string,
      ) => {
        if (loading) {
          return;
        }

        setHistoryLoading(
          true,
        );

        setErrorMessage(
          null,
        );

        try {
          const response =
            await fetch(
              `/api/ai/conversations/${conversationId}`,
              {
                method: "GET",
                cache: "no-store",
              },
            );

          if (!response.ok) {
            let error =
              "تعذر تحميل المحادثة.";

            try {
              const data =
                (await response.json()) as ApiConversationDetailResponse;

              if (
                typeof data.error ===
                "string"
              ) {
                error =
                  data.error;
              }
            } catch {
              // Keep default error.
            }

            throw new Error(
              error,
            );
          }

          const data =
            (await response.json()) as ApiConversationDetailResponse;

          if (
            !data.success ||
            !data.data
          ) {
            throw new Error(
              "تعذر تحميل المحادثة.",
            );
          }

          const loadedMessages =
            data.data.messages
              .filter(
                (message) =>
                  message.role ===
                    "USER" ||
                  message.role ===
                    "ASSISTANT",
              )
              .map(
                (
                  message,
                ): Message => ({
                  id:
                    message.id,

                  role:
                    message.role ===
                    "USER"
                      ? "user"
                      : "assistant",

                  content:
                    message.content,

                  status:
                    message.status,

                  createdAt:
                    message.createdAt,
                }),
              );

          setCurrentConversationId(
            data.data.id,
          );

          setMessages(
            loadedMessages.length >
              0
              ? loadedMessages
              : [WELCOME_MESSAGE],
          );

          setInput("");
        } catch (error) {
          console.error(
            "AI conversation load error:",
            error,
          );

          setErrorMessage(
            error instanceof
              Error
              ? error.message
              : "تعذر تحميل المحادثة.",
          );
        } finally {
          setHistoryLoading(
            false,
          );
        }
      },
      [loading],
    );

  /*
   * --------------------------------------------------
   * NEW CHAT
   * --------------------------------------------------
   *
   * We intentionally do NOT create the DB conversation
   * here. The server creates it when the first message
   * is sent.
   */
  function startNewChat() {
    if (loading) {
      return;
    }

    setCurrentConversationId(
      null,
    );

    setMessages([
      WELCOME_MESSAGE,
    ]);

    setInput("");

    setErrorMessage(
      null,
    );
  }

  /*
   * --------------------------------------------------
   * SEND MESSAGE
   * --------------------------------------------------
   */
  async function sendMessage(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const text =
      input.trim();

    if (
      !text ||
      loading ||
      historyLoading
    ) {
      return;
    }

    setErrorMessage(
      null,
    );

    const userMessage: Message =
      {
        role: "user",
        content: text,
      };

    /*
     * Add the user's message immediately.
     */
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
     * Streaming tokens will be appended to it.
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

                /*
                 * When null, the server creates a
                 * new conversation automatically.
                 */
                ...(currentConversationId
                  ? {
                      conversationId:
                        currentConversationId,
                    }
                  : {}),

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

          /*
           * ------------------------------------------------
           * STREAM DELTA
           * ------------------------------------------------
           */
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

          /*
           * ------------------------------------------------
           * STREAM ERROR
           * ------------------------------------------------
           */
          if (
            eventData.type ===
            "error"
          ) {
            throw new Error(
              eventData.error ||
                "AI_STREAM_FAILED",
            );
          }

          /*
           * ------------------------------------------------
           * STREAM COMPLETE
           * ------------------------------------------------
           */
          if (
            eventData.type ===
            "done"
          ) {
            /*
             * The first message of a new chat receives
             * its conversation ID from the server here.
             */
            if (
              eventData.conversationId
            ) {
              setCurrentConversationId(
                eventData.conversationId,
              );
            }

            /*
             * Refresh the sidebar so the new conversation
             * immediately appears in history.
             */
            await loadConversations();

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

      setErrorMessage(
        errorMessage,
      );

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
      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "minmax(190px, 230px) minmax(0, 1fr)",
          gap: "18px",
          alignItems: "stretch",
        }}
      >
        {/*
         * ==================================================
         * CHAT HISTORY
         * ==================================================
         */}
        <aside
          style={{
            border:
              "1px solid rgba(255,255,255,0.08)",

            borderRadius:
              "18px",

            background:
              "rgba(255,255,255,0.025)",

            padding:
              "14px",

            minHeight:
              "420px",

            display: "flex",

            flexDirection:
              "column",

            gap: "12px",
          }}
        >
          <button
            type="button"
            onClick={
              startNewChat
            }
            disabled={
              loading ||
              historyLoading
            }
            className="btn"
            style={{
              width: "100%",
              opacity:
                loading ||
                historyLoading
                  ? 0.6
                  : 1,
            }}
          >
            + محادثة جديدة
          </button>

          <div
            style={{
              display: "flex",
              alignItems:
                "center",
              justifyContent:
                "space-between",
              gap: "8px",
            }}
          >
            <span
              className="badge"
            >
              سجل المحادثات
            </span>

            {conversations.length >
              0 && (
              <span
                className="muted"
                style={{
                  fontSize:
                    "12px",
                }}
              >
                {
                  conversations.length
                }
              </span>
            )}
          </div>

          <div
            style={{
              display: "flex",
              flexDirection:
                "column",
              gap: "8px",
              overflowY:
                "auto",
              flex: 1,
            }}
          >
            {conversationsLoading && (
              <div
                className="muted"
                style={{
                  padding:
                    "12px 6px",
                  fontSize:
                    "13px",
                }}
              >
                جاري تحميل المحادثات...
              </div>
            )}

            {!conversationsLoading &&
              conversations.length ===
                0 && (
                <div
                  className="muted"
                  style={{
                    padding:
                      "12px 6px",
                    fontSize:
                      "13px",
                    lineHeight:
                      1.7,
                  }}
                >
                  لا توجد محادثات محفوظة حتى الآن.
                </div>
              )}

            {!conversationsLoading &&
              conversations.map(
                (
                  conversation,
                ) => {
                  const active =
                    currentConversationId ===
                    conversation.id;

                  return (
                    <button
                      key={
                        conversation.id
                      }
                      type="button"
                      onClick={() =>
                        openConversation(
                          conversation.id,
                        )
                      }
                      disabled={
                        loading ||
                        historyLoading
                      }
                      style={{
                        width:
                          "100%",
                        textAlign:
                          "right",
                        border:
                          active
                            ? "1px solid rgba(168,85,247,0.65)"
                            : "1px solid rgba(255,255,255,0.06)",
                        borderRadius:
                          "14px",
                        background:
                          active
                            ? "rgba(168,85,247,0.12)"
                            : "rgba(255,255,255,0.025)",
                        padding:
                          "11px",
                        cursor:
                          loading ||
                          historyLoading
                            ? "default"
                            : "pointer",
                        opacity:
                          loading ||
                          historyLoading
                            ? 0.65
                            : 1,
                      }}
                    >
                      <div
                        style={{
                          fontWeight:
                            700,
                          fontSize:
                            "13px",
                          lineHeight:
                            1.5,
                          overflow:
                            "hidden",
                          textOverflow:
                            "ellipsis",
                          whiteSpace:
                            "nowrap",
                        }}
                      >
                        {getConversationLabel(
                          conversation,
                        )}
                      </div>

                      <div
                        style={{
                          marginTop:
                            "5px",
                          display:
                            "flex",
                          justifyContent:
                            "space-between",
                          gap:
                            "8px",
                          fontSize:
                            "11px",
                          opacity:
                            0.6,
                        }}
                      >
                        <span>
                          {formatConversationDate(
                            conversation.updatedAt,
                          )}
                        </span>

                        {conversation
                          ._count
                          ?.messages !==
                          undefined && (
                          <span>
                            {
                              conversation
                                ._count
                                .messages
                            }{" "}
                            رسالة
                          </span>
                        )}
                      </div>
                    </button>
                  );
                },
              )}
          </div>
        </aside>

        {/*
         * ==================================================
         * CHAT AREA
         * ==================================================
         */}
        <div
          style={{
            minWidth:
              0,
          }}
        >
          <div className="ai-chat-header">
            <div>
              <span className="badge">
                GAMEVORTEX AI
              </span>

              <h2>
                المساعد الذكي
              </h2>

              <p className="muted">
                {currentConversationId
                  ? "المحادثة محفوظة ويمكنك العودة إليها لاحقًا."
                  : "محادثة جديدة"}
              </p>
            </div>

            <div className="ai-status">
              <span className="ai-status-dot" />

              <span>
                متاح
              </span>
            </div>
          </div>

          {errorMessage && (
            <div
              style={{
                margin:
                  "0 0 12px",
                padding:
                  "10px 12px",
                border:
                  "1px solid rgba(239,68,68,0.35)",
                borderRadius:
                  "12px",
                background:
                  "rgba(239,68,68,0.08)",
                color:
                  "#fecaca",
                fontSize:
                  "13px",
              }}
            >
              {errorMessage}
            </div>
          )}

          <div className="ai-chat-messages">
            {historyLoading ? (
              <div
                className="ai-message ai-message-assistant"
              >
                <div className="ai-message-role">
                  GameVortex AI
                </div>

                <div className="ai-message-content">
                  جاري تحميل المحادثة...
                </div>
              </div>
            ) : (
              messages.map(
                (
                  message,
                  index,
                ) => (
                  <div
                    key={
                      message.id ??
                      `${message.role}-${index}`
                    }
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
              )
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
                loading ||
                historyLoading
              }
              maxLength={4000}
            />

            <button
              type="submit"
              disabled={
                loading ||
                historyLoading ||
                !input.trim()
              }
              className="btn"
            >
              {loading
                ? "جاري الإرسال..."
                : "إرسال"}
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
