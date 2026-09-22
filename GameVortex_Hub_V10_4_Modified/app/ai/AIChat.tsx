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
   * =====================================================
   * LOAD CONVERSATIONS
   * =====================================================
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

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  /*
   * =====================================================
   * OPEN EXISTING CONVERSATION
   * =====================================================
   */
  const openConversation =
    useCallback(
      async (
        conversationId: string,
      ) => {
        if (
          loading ||
          historyLoading
        ) {
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
              : [
                  WELCOME_MESSAGE,
                ],
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
      [
        loading,
        historyLoading,
      ],
    );

  /*
   * =====================================================
   * NEW CHAT
   * =====================================================
   *
   * We intentionally do not create the DB record here.
   * The server creates it when the first message is sent.
   */
  function startNewChat() {
    if (
      loading ||
      historyLoading
    ) {
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
   * =====================================================
   * SEND MESSAGE
   * =====================================================
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
     * Immediately show the user's message.
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
     * Create the assistant placeholder.
     * Streaming tokens will be inserted into it.
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
       * Errors that happen before Streaming starts
       * are returned as JSON.
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
      let receivedAssistantText =
        false;

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
           * -----------------------------------------------
           * STREAM DELTA
           * -----------------------------------------------
           */
          if (
            eventData.type ===
            "delta"
          ) {
            const delta =
              eventData.text;

            if (delta) {
              receivedAssistantText =
                true;
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
           * -----------------------------------------------
           * STREAM ERROR
           * -----------------------------------------------
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
           * -----------------------------------------------
           * STREAM COMPLETE
           * -----------------------------------------------
           */
          if (
            eventData.type ===
            "done"
          ) {
            if (
              eventData.conversationId
            ) {
              setCurrentConversationId(
                eventData.conversationId,
              );
            }

            await loadConversations();

            finished = true;
            break;
          }
        }
      }

      /*
       * If the server closed the stream without sending
       * a valid assistant response.
       */
      if (
        !receivedAssistantText
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
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "حدث خطأ غير متوقع.";

      setErrorMessage(
        message,
      );

      /*
       * Convert the empty assistant placeholder into
       * a visible error message.
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
                `تعذر تنفيذ الطلب: ${message}`,
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
    <>
      <style jsx>{`
        .gv-ai-root {
          width: 100%;
          min-width: 0;
          box-sizing: border-box;
        }

        .gv-ai-layout {
          width: 100%;
          min-width: 0;
          box-sizing: border-box;

          display: grid;
          grid-template-columns:
            minmax(190px, 230px)
            minmax(0, 1fr);

          gap: 18px;
          align-items: stretch;
        }

        .gv-ai-history {
          width: 100%;
          min-width: 0;
          min-height: 420px;
          box-sizing: border-box;

          display: flex;
          flex-direction: column;
          gap: 12px;

          padding: 14px;

          overflow: hidden;

          border:
            1px solid
            rgba(255, 255, 255, 0.08);

          border-radius: 18px;

          background:
            rgba(255, 255, 255, 0.025);
        }

        .gv-ai-history-list {
          width: 100%;
          min-width: 0;
          min-height: 0;

          flex: 1;

          display: flex;
          flex-direction: column;
          gap: 8px;

          overflow-x: hidden;
          overflow-y: auto;

          overscroll-behavior: contain;
        }

        .gv-ai-new-chat {
          width: 100%;
          min-height: 44px;

          white-space: nowrap;

          box-sizing: border-box;
        }

        .gv-ai-history-item {
          width: 100%;
          min-width: 0;

          display: block;

          padding: 11px;

          box-sizing: border-box;

          text-align: right;

          border:
            1px solid
            rgba(255, 255, 255, 0.06);

          border-radius: 14px;

          background:
            rgba(255, 255, 255, 0.025);

          color: inherit;

          cursor: pointer;

          transition:
            background 0.2s ease,
            border-color 0.2s ease,
            transform 0.2s ease;
        }

        .gv-ai-history-item:hover {
          border-color:
            rgba(168, 85, 247, 0.35);

          background:
            rgba(168, 85, 247, 0.08);
        }

        .gv-ai-history-item-active {
          border-color:
            rgba(168, 85, 247, 0.65);

          background:
            rgba(168, 85, 247, 0.12);
        }

        .gv-ai-history-item:disabled {
          cursor: default;
          opacity: 0.65;
        }

        .gv-ai-history-title {
          width: 100%;
          min-width: 0;

          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;

          font-size: 13px;
          font-weight: 700;
          line-height: 1.5;
        }

        .gv-ai-history-meta {
          min-width: 0;

          display: flex;
          align-items: center;
          justify-content: space-between;

          gap: 8px;

          margin-top: 5px;

          font-size: 11px;

          opacity: 0.6;
        }

        .gv-ai-history-meta span {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .gv-ai-chat {
          width: 100%;
          min-width: 0;
          box-sizing: border-box;

          overflow: hidden;
        }

        .gv-ai-header {
          width: 100%;
          min-width: 0;

          display: flex;
          align-items: center;
          justify-content: space-between;

          gap: 16px;

          margin-bottom: 14px;
        }

        .gv-ai-header-text {
          min-width: 0;
        }

        .gv-ai-header-title {
          margin:
            8px 0 0;

          overflow-wrap: anywhere;

          font-size:
            clamp(22px, 3vw, 30px);

          line-height: 1.25;
        }

        .gv-ai-header-description {
          margin:
            5px 0 0;

          line-height: 1.6;

          overflow-wrap: anywhere;
        }

        .gv-ai-status {
          flex:
            0 0 auto;

          display: flex;
          align-items: center;
          gap: 7px;

          white-space: nowrap;
        }

        .gv-ai-error {
          width: 100%;
          box-sizing: border-box;

          margin-bottom: 12px;

          padding:
            10px 12px;

          overflow-wrap: anywhere;

          border:
            1px solid
            rgba(239, 68, 68, 0.35);

          border-radius: 12px;

          background:
            rgba(239, 68, 68, 0.08);

          color:
            #fecaca;

          font-size: 13px;
          line-height: 1.6;
        }

        .gv-ai-messages {
          width: 100%;
          min-width: 0;
          box-sizing: border-box;

          min-height: 280px;
          max-height: 560px;

          padding:
            4px;

          overflow-x: hidden;
          overflow-y: auto;

          overscroll-behavior: contain;

          scrollbar-width: thin;
        }

        .gv-ai-message {
          width: fit-content;

          max-width:
            min(82%, 760px);

          margin-bottom: 12px;

          padding:
            12px 14px;

          box-sizing: border-box;

          border:
            1px solid
            rgba(255, 255, 255, 0.08);

          border-radius: 16px;

          overflow-wrap: anywhere;
          word-break: break-word;

          line-height: 1.75;
        }

        .gv-ai-message-user {
          margin-right: 0;
          margin-left: auto;

          background:
            rgba(124, 58, 237, 0.14);

          border-color:
            rgba(168, 85, 247, 0.22);
        }

        .gv-ai-message-assistant {
          margin-right: auto;
          margin-left: 0;

          background:
            rgba(255, 255, 255, 0.035);
        }

        .gv-ai-message-role {
          margin-bottom: 5px;

          font-size: 11px;
          font-weight: 800;

          opacity: 0.65;
        }

        .gv-ai-message-content {
          min-width: 0;

          white-space: pre-wrap;

          overflow-wrap: anywhere;
          word-break: break-word;
        }

        .gv-ai-form {
          width: 100%;
          min-width: 0;
          box-sizing: border-box;

          display: flex;
          align-items: stretch;

          gap: 10px;

          margin-top: 14px;
        }

        .gv-ai-textarea {
          flex:
            1 1 auto;

          width: 100%;
          min-width: 0;
          min-height: 88px;

          box-sizing: border-box;

          resize: vertical;

          padding:
            13px 14px;

          border:
            1px solid
            rgba(255, 255, 255, 0.1);

          border-radius: 15px;

          background:
            rgba(255, 255, 255, 0.035);

          color: #fff;

          outline: none;

          font: inherit;

          line-height: 1.6;
        }

        .gv-ai-textarea::placeholder {
          color:
            rgba(203, 213, 225, 0.45);
        }

        .gv-ai-textarea:focus {
          border-color:
            rgba(168, 85, 247, 0.55);

          box-shadow:
            0 0 0 3px
            rgba(168, 85, 247, 0.08);
        }

        .gv-ai-send {
          flex:
            0 0 110px;

          min-height: 88px;

          box-sizing: border-box;

          white-space: nowrap;
        }

        .gv-ai-empty {
          padding:
            12px 6px;

          font-size: 13px;

          line-height: 1.7;

          overflow-wrap: anywhere;
        }

        .gv-ai-loading {
          padding:
            12px 6px;

          font-size: 13px;

          line-height: 1.7;

          opacity: 0.7;
        }

        /*
         * ==============================================
         * TABLET
         * ==============================================
         */

        @media (max-width: 900px) {
          .gv-ai-layout {
            grid-template-columns:
              minmax(175px, 200px)
              minmax(0, 1fr);

            gap: 14px;
          }

          .gv-ai-history {
            padding: 11px;
          }

          .gv-ai-message {
            max-width: 88%;
          }

          .gv-ai-send {
            flex-basis: 96px;
          }
        }

        /*
         * ==============================================
         * MOBILE
         * ==============================================
         */

        @media (max-width: 700px) {
          .gv-ai-layout {
            display: flex;
            flex-direction: column;

            width: 100%;
            gap: 14px;
          }

          .gv-ai-history {
            width: 100%;
            min-height: auto;

            max-height: none;

            padding: 11px;

            box-sizing: border-box;
          }

          .gv-ai-history-list {
            width: 100%;

            max-height: 190px;

            overflow-x: hidden;
            overflow-y: auto;
          }

          .gv-ai-history-item {
            flex:
              0 0 auto;

            width: 100%;
          }

          .gv-ai-chat {
            width: 100%;
            min-width: 0;
          }

          .gv-ai-header {
            align-items: flex-start;

            flex-direction: column;

            gap: 9px;
          }

          .gv-ai-status {
            align-self: flex-start;
          }

          .gv-ai-messages {
            width: 100%;

            min-height: 250px;
            max-height: 480px;
          }

          .gv-ai-message {
            width: auto;

            max-width: 92%;

            padding:
              10px 12px;
          }

          .gv-ai-form {
            flex-direction: column;

            width: 100%;

            gap: 9px;
          }

          .gv-ai-textarea {
            width: 100%;

            min-height: 100px;
          }

          .gv-ai-send {
            width: 100%;

            flex:
              0 0 auto;

            min-height: 48px;
          }
        }

        /*
         * ==============================================
         * SMALL PHONES
         * ==============================================
         */

        @media (max-width: 430px) {
          .gv-ai-history {
            padding: 10px;

            border-radius: 15px;
          }

          .gv-ai-history-list {
            max-height: 165px;
          }

          .gv-ai-history-item {
            padding: 10px;
          }

          .gv-ai-history-title {
            font-size: 12px;
          }

          .gv-ai-history-meta {
            font-size: 10px;
          }

          .gv-ai-messages {
            min-height: 220px;
            max-height: 430px;
          }

          .gv-ai-message {
            max-width: 94%;

            padding:
              10px 11px;

            border-radius: 14px;

            font-size: 14px;
          }

          .gv-ai-header-title {
            font-size: 22px;
          }

          .gv-ai-form {
            gap: 8px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .gv-ai-history-item {
            transition: none;
          }
        }
      `}</style>

      <section className="glass card gv-ai-root">
        <div className="gv-ai-layout">

          {/* =================================================
              CHAT HISTORY
          ================================================== */}

          <aside className="gv-ai-history">

            <button
              type="button"
              onClick={
                startNewChat
              }
              disabled={
                loading ||
                historyLoading
              }
              className="btn gv-ai-new-chat"
            >
              + محادثة جديدة
            </button>

            <div
              style={{
                display:
                  "flex",
                alignItems:
                  "center",
                justifyContent:
                  "space-between",
                gap: "8px",
              }}
            >
              <span className="badge">
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

            <div className="gv-ai-history-list">

              {conversationsLoading && (
                <div className="gv-ai-loading">
                  جاري تحميل المحادثات...
                </div>
              )}

              {!conversationsLoading &&
                conversations.length ===
                  0 && (
                  <div className="gv-ai-empty muted">
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
                        className={`gv-ai-history-item ${
                          active
                            ? "gv-ai-history-item-active"
                            : ""
                        }`}
                      >
                        <div className="gv-ai-history-title">
                          {getConversationLabel(
                            conversation,
                          )}
                        </div>

                        <div className="gv-ai-history-meta">
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

          {/* =================================================
              CHAT AREA
          ================================================== */}

          <div className="gv-ai-chat">

            <div className="gv-ai-header">

              <div className="gv-ai-header-text">

                <span className="badge">
                  GAMEVORTEX AI
                </span>

                <h2 className="gv-ai-header-title">
                  المساعد الذكي
                </h2>

                <p className="muted gv-ai-header-description">
                  {currentConversationId
                    ? "المحادثة محفوظة ويمكنك العودة إليها لاحقًا."
                    : "محادثة جديدة"}
                </p>

              </div>

              <div className="ai-status gv-ai-status">
                <span className="ai-status-dot" />

                <span>
                  متاح
                </span>
              </div>

            </div>

            {errorMessage && (
              <div className="gv-ai-error">
                {errorMessage}
              </div>
            )}

            <div className="gv-ai-messages">

              {historyLoading ? (
                <div className="ai-message ai-message-assistant">
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
                      className={`gv-ai-message ${
                        message.role ===
                        "user"
                          ? "gv-ai-message-user"
                          : "gv-ai-message-assistant"
                      }`}
                    >
                      <div className="gv-ai-message-role">
                        {message.role ===
                        "user"
                          ? "أنت"
                          : "GameVortex AI"}
                      </div>

                      <div className="gv-ai-message-content">
                        {message.content}
                      </div>
                    </div>
                  ),
                )
              )}

            </div>

            <form
              onSubmit={
                sendMessage
              }
              className="gv-ai-form"
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
                className="gv-ai-textarea"
              />

              <button
                type="submit"
                disabled={
                  loading ||
                  historyLoading ||
                  !input.trim()
                }
                className="btn gv-ai-send"
              >
                {loading
                  ? "جاري الإرسال..."
                  : "إرسال"}
              </button>

            </form>

          </div>
        </div>
      </section>
    </>
  );
}
