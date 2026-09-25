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

function normalizeRole(
  role: MessageRole,
): "user" | "assistant" {
  return role === "USER" ||
    role === "user"
    ? "user"
    : "assistant";
}

function isAssistantMessage(
  message: Message,
) {
  return (
    normalizeRole(message.role) ===
    "assistant"
  );
}

async function copyTextToClipboard(
  text: string,
) {
  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    window.isSecureContext
  ) {
    await navigator.clipboard.writeText(
      text,
    );

    return;
  }

  const textarea =
    document.createElement(
      "textarea",
    );

  textarea.value = text;
  textarea.setAttribute(
    "readonly",
    "",
  );

  textarea.style.position =
    "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents =
    "none";

  document.body.appendChild(
    textarea,
  );

  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(
    0,
    textarea.value.length,
  );

  const copied =
    document.execCommand(
      "copy",
    );

  document.body.removeChild(
    textarea,
  );

  if (!copied) {
    throw new Error(
      "COPY_FAILED",
    );
  }
}

export default function AIChat() {
  const [messages, setMessages] =
    useState<Message[]>([
      WELCOME_MESSAGE,
    ]);

  const [input, setInput] =
    useState("");

  const [loading, setLoading] =
    useState(false);

  const [stopping, setStopping] =
    useState(false);

  const [
    regeneratingMessageId,
    setRegeneratingMessageId,
  ] = useState<string | null>(
    null,
  );

  const [
    conversations,
    setConversations,
  ] = useState<Conversation[]>(
    [],
  );

  const [
    conversationId,
    setConversationId,
  ] = useState<string | null>(
    null,
  );

  const [
    historyLoading,
    setHistoryLoading,
  ] = useState(false);

  const [
    historyOpen,
    setHistoryOpen,
  ] = useState(false);

  const [
    copiedMessageId,
    setCopiedMessageId,
  ] = useState<string | null>(
    null,
  );

  const [
    renamingConversationId,
    setRenamingConversationId,
  ] = useState<string | null>(
    null,
  );

  const [
    renameValue,
    setRenameValue,
  ] = useState("");

  const [
    deletingConversationId,
    setDeletingConversationId,
  ] = useState<string | null>(
    null,
  );

  const abortControllerRef =
    useRef<AbortController | null>(
      null,
    );

  const assistantMessageIdRef =
    useRef<string | null>(null);

  const stoppedRef =
    useRef(false);

  const copyTimerRef =
    useRef<ReturnType<
      typeof setTimeout
    > | null>(null);

  const messagesEndRef =
    useRef<HTMLDivElement | null>(
      null,
    );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView(
      {
        behavior: "smooth",
        block: "end",
      },
    );
  }, [messages, loading]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();

      if (copyTimerRef.current) {
        clearTimeout(
          copyTimerRef.current,
        );
      }
    };
  }, []);

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
         * Conversation history is secondary UI.
         */
      } finally {
        setHistoryLoading(false);
      }
    }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

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
        typeof data?.error ===
          "string"
          ? data.error
          : "AI_CONVERSATION_CREATE_FAILED",
      );
    }

    return data.data as Conversation;
  }

  async function startNewChat() {
    if (
      loading ||
      stopping ||
      regeneratingMessageId ||
      renamingConversationId ||
      deletingConversationId
    ) {
      return;
    }

    setMessages([
      WELCOME_MESSAGE,
    ]);

    setConversationId(null);
    setInput("");
    setCopiedMessageId(null);
    setHistoryOpen(false);
    setRenameValue("");
    setRenamingConversationId(null);
  }

  async function loadConversation(
    id: string,
  ) {
    if (
      loading ||
      stopping ||
      regeneratingMessageId ||
      renamingConversationId ||
      deletingConversationId
    ) {
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
          typeof data?.error ===
            "string"
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

  async function startRenameConversation(
    conversation: Conversation,
  ) {
    if (
      loading ||
      stopping ||
      regeneratingMessageId ||
      deletingConversationId
    ) {
      return;
    }

    setRenamingConversationId(
      conversation.id,
    );

    setRenameValue(
      conversation.title ||
        "New Chat",
    );
  }

  function cancelRename() {
    setRenamingConversationId(
      null,
    );

    setRenameValue("");
  }

  async function saveConversationRename(
    id: string,
  ) {
    const title =
      renameValue.trim();

    if (!title) {
      return;
    }

    if (title.length > 80) {
      return;
    }

    if (
      loading ||
      stopping ||
      regeneratingMessageId ||
      deletingConversationId
    ) {
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
            method: "PATCH",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              title,
            }),
          },
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          typeof data?.error ===
            "string"
            ? data.error
            : "CONVERSATION_RENAME_FAILED",
        );
      }

      const updatedConversation =
        data?.data ??
        data?.conversation;

      setConversations(
        (current) =>
          current.map(
            (conversation) =>
              conversation.id === id
                ? {
                    ...conversation,
                    title:
                      updatedConversation?.title ??
                      title,
                    updatedAt:
                      updatedConversation?.updatedAt ??
                      conversation.updatedAt,
                  }
                : conversation,
          ),
      );

      setRenamingConversationId(
        null,
      );

      setRenameValue("");
    } catch (error) {
      console.error(
        "AI_CONVERSATION_RENAME_ERROR",
        error,
      );
    } finally {
      setHistoryLoading(false);
    }
  }

  async function deleteConversation(
    conversation: Conversation,
  ) {
    if (
      loading ||
      stopping ||
      regeneratingMessageId ||
      renamingConversationId ||
      deletingConversationId
    ) {
      return;
    }

    const confirmed =
      window.confirm(
        `هل تريد حذف المحادثة "${conversation.title || "New Chat"}"؟\n\nسيتم حذف رسائلها أيضًا ولا يمكن التراجع عن العملية.`,
      );

    if (!confirmed) {
      return;
    }

    try {
      setDeletingConversationId(
        conversation.id,
      );

      const response =
        await fetch(
          `/api/ai/conversations/${encodeURIComponent(
            conversation.id,
          )}`,
          {
            method: "DELETE",
          },
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          typeof data?.error ===
            "string"
            ? data.error
            : "CONVERSATION_DELETE_FAILED",
        );
      }

      setConversations(
        (current) =>
          current.filter(
            (item) =>
              item.id !==
              conversation.id,
          ),
      );

      /*
       * If the deleted conversation is the currently
       * open conversation, reset the chat immediately.
       */
      if (
        conversationId ===
        conversation.id
      ) {
        setConversationId(null);

        setMessages([
          WELCOME_MESSAGE,
        ]);

        setInput("");
        setCopiedMessageId(null);
      }

      setRenamingConversationId(
        null,
      );

      setRenameValue("");
    } catch (error) {
      console.error(
        "AI_CONVERSATION_DELETE_ERROR",
        error,
      );
    } finally {
      setDeletingConversationId(
        null,
      );
    }
  }

  async function regenerateMessage(
    message: Message,
  ) {
    if (
      !message.id ||
      loading ||
      stopping ||
      regeneratingMessageId ||
      renamingConversationId ||
      deletingConversationId
    ) {
      return;
    }

    if (
      !isAssistantMessage(
        message,
      )
    ) {
      return;
    }

    if (
      message.status ===
        "PENDING" ||
      message.status ===
        "STREAMING"
    ) {
      return;
    }

    const messageId =
      message.id;

    setRegeneratingMessageId(
      messageId,
    );

    setCopiedMessageId(null);

    try {
      const response =
        await fetch(
          `/api/ai/messages/${encodeURIComponent(
            messageId,
          )}`,
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              action:
                "regenerate",
            }),
          },
        );

      const data =
        await response.json();

      if (!response.ok) {
        const publicError =
          typeof data?.error ===
          "string"
            ? data.error
            : "AI_REGENERATE_FAILED";

        throw new Error(
          publicError,
        );
      }

      const regenerated =
        data?.message;

      if (
        !regenerated?.id
      ) {
        throw new Error(
          "AI_REGENERATE_INVALID_RESPONSE",
        );
      }

      setMessages(
        (current) =>
          current.map(
            (item) =>
              item.id ===
              regenerated.id
                ? {
                    ...item,
                    id:
                      regenerated.id,
                    role:
                      regenerated.role,
                    status:
                      regenerated.status,
                    content:
                      regenerated.content,
                    createdAt:
                      regenerated.createdAt,
                    updatedAt:
                      regenerated.updatedAt,
                  }
                : item,
          ),
      );

      await loadConversations();
    } catch (error) {
      console.error(
        "AI_REGENERATE_ERROR",
        error,
      );

      const errorMessage =
        error instanceof Error
          ? error.message
          : "AI_REGENERATE_FAILED";

      setMessages(
        (current) =>
          current.map(
            (item) =>
              item.id ===
              messageId
                ? {
                    ...item,
                    status:
                      "ERROR",
                    content:
                      message.content +
                      `\n\nتعذر إعادة التوليد: ${errorMessage}`,
                  }
                : item,
          ),
      );
    } finally {
      setRegeneratingMessageId(
        null,
      );
    }
  }

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
      stopping ||
      regeneratingMessageId ||
      renamingConversationId ||
      deletingConversationId
    ) {
      return;
    }

    stoppedRef.current = false;

    assistantMessageIdRef.current =
      null;

    setCopiedMessageId(null);

    const userMessage: Message =
      {
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

        setConversations(
          (current) => [
            conversation,
            ...current,
          ],
        );
      }

      setMessages(
        (current) => [
          ...current,
          {
            role: "assistant",
            content: "",
            status:
              "STREAMING",
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

          if (
            eventData.type ===
            "meta"
          ) {
            if (
              eventData.conversationId
            ) {
              activeConversationId =
                eventData.conversationId;

              setConversationId(
                eventData.conversationId,
              );
            }

            if (
              eventData.assistantMessageId
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
                    eventData.text,
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
      if (
        error instanceof
          DOMException &&
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
              loading ||
              regeneratingMessageId
                ? "ai-status-dot-active"
                : ""
            }`}
          />

          <span>
            {stopping
              ? "جارٍ الإيقاف"
              : regeneratingMessageId
                ? "جارٍ إعادة التوليد"
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
            stopping ||
            !!regeneratingMessageId
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
            stopping ||
            !!regeneratingMessageId ||
            !!renamingConversationId ||
            !!deletingConversationId
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
                ) => {
                  const isRenaming =
                    renamingConversationId ===
                    conversation.id;

                  const isDeleting =
                    deletingConversationId ===
                    conversation.id;

                  return (
                    <div
                      key={
                        conversation.id
                      }
                      className={`gv-ai-history-item-wrapper ${
                        conversationId ===
                        conversation.id
                          ? "active"
                          : ""
                      }`}
                    >
                      {isRenaming ? (
                        <div className="gv-ai-rename-box">
                          <input
                            value={
                              renameValue
                            }
                            onChange={(
                              event,
                            ) =>
                              setRenameValue(
                                event
                                  .target
                                  .value,
                              )
                            }
                            onKeyDown={(
                              event,
                            ) => {
                              if (
                                event.key ===
                                "Enter"
                              ) {
                                event.preventDefault();

                                void saveConversationRename(
                                  conversation.id,
                                );
                              }

                              if (
                                event.key ===
                                "Escape"
                              ) {
                                event.preventDefault();

                                cancelRename();
                              }
                            }}
                            maxLength={
                              80
                            }
                            autoFocus
                            disabled={
                              historyLoading
                            }
                            aria-label="اسم المحادثة الجديد"
                          />

                          <div className="gv-ai-rename-actions">
                            <button
                              type="button"
                              className="gv-ai-save"
                              onClick={() =>
                                void saveConversationRename(
                                  conversation.id,
                                )
                              }
                              disabled={
                                historyLoading ||
                                !renameValue.trim()
                              }
                            >
                              حفظ
                            </button>

                            <button
                              type="button"
                              className="gv-ai-cancel"
                              onClick={
                                cancelRename
                              }
                              disabled={
                                historyLoading
                              }
                            >
                              إلغاء
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="gv-ai-history-item"
                            onClick={() =>
                              void loadConversation(
                                conversation.id,
                              )
                            }
                            disabled={
                              loading ||
                              stopping ||
                              historyLoading ||
                              !!regeneratingMessageId ||
                              !!renamingConversationId ||
                              !!deletingConversationId
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

                          <div className="gv-ai-history-actions">
                            <button
                              type="button"
                              className="gv-ai-rename-button"
                              onClick={() =>
                                void startRenameConversation(
                                  conversation,
                                )
                              }
                              disabled={
                                loading ||
                                stopping ||
                                !!regeneratingMessageId ||
                                !!deletingConversationId ||
                                historyLoading
                              }
                              aria-label={`إعادة تسمية ${conversation.title}`}
                            >
                              ✏️
                            </button>

                            <button
                              type="button"
                              className="gv-ai-delete-button"
                              onClick={() =>
                                void deleteConversation(
                                  conversation,
                                )
                              }
                              disabled={
                                loading ||
                                stopping ||
                                !!regeneratingMessageId ||
                                !!renamingConversationId ||
                                !!deletingConversationId
                              }
                              aria-label={`حذف ${conversation.title}`}
                            >
                              {isDeleting
                                ? "..."
                                : "🗑️"}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                },
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

            const isRegenerating =
              regeneratingMessageId ===
              message.id;

            const canRegenerate =
              isAssistant &&
              !!message.id &&
              message.content.trim()
                .length > 0 &&
              message.status !==
                "PENDING" &&
              message.status !==
                "STREAMING" &&
              !isRegenerating;

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
                        disabled={
                          !!regeneratingMessageId ||
                          !!renamingConversationId ||
                          !!deletingConversationId
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

                      {canRegenerate && (
                        <button
                          type="button"
                          className="gv-ai-regenerate"
                          onClick={() =>
                            void regenerateMessage(
                              message,
                            )
                          }
                          disabled={
                            loading ||
                            stopping ||
                            !!regeneratingMessageId ||
                            !!renamingConversationId ||
                            !!deletingConversationId
                          }
                          aria-label="إعادة توليد الرد"
                        >
                          ↻ إعادة التوليد
                        </button>
                      )}
                    </div>
                  )}

                {isRegenerating && (
                  <div className="gv-ai-regenerating">
                    جاري إعادة توليد الرد...
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
            stopping ||
            !!regeneratingMessageId ||
            !!renamingConversationId ||
            !!deletingConversationId
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
              stopping ||
              !!regeneratingMessageId ||
              !!renamingConversationId ||
              !!deletingConversationId
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
        .gv-ai-copy,
        .gv-ai-regenerate,
        .gv-ai-rename-button,
        .gv-ai-delete-button,
        .gv-ai-save,
        .gv-ai-cancel {
          appearance: none;
          border: 1px solid
            rgba(255, 255, 255, 0.12);
          background: rgba(
            255,
            255,
            255,
            0.045
          );
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
        .gv-ai-copy:hover,
        .gv-ai-regenerate:hover,
        .gv-ai-rename-button:hover,
        .gv-ai-delete-button:hover,
        .gv-ai-save:hover,
        .gv-ai-cancel:hover {
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
        .gv-ai-copy:disabled,
        .gv-ai-regenerate:disabled,
        .gv-ai-rename-button:disabled,
        .gv-ai-delete-button:disabled,
        .gv-ai-save:disabled,
        .gv-ai-cancel:disabled {
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
          max-height: 320px;
          overflow-y: auto;
        }

        .gv-ai-history-item-wrapper {
          position: relative;
          display: flex;
          align-items: center;
          gap: 7px;
          width: 100%;
          padding: 4px;
          border: 1px solid
            rgba(255, 255, 255, 0.07);
          border-radius: 12px;
          background: rgba(
            255,
            255,
            255,
            0.025
          );
        }

        .gv-ai-history-item-wrapper.active {
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

        .gv-ai-history-item {
          flex: 1;
          min-width: 0;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          min-height: 42px;
          padding: 7px 8px;
          border: 0;
          background: transparent;
          color: #e2e8f0;
          text-align: start;
          cursor: pointer;
        }

        .gv-ai-history-item:hover {
          color: #fff;
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

        .gv-ai-history-actions {
          display: flex;
          align-items: center;
          gap: 4px;
          flex: 0 0 auto;
        }

        .gv-ai-rename-button,
        .gv-ai-delete-button {
          width: 34px;
          height: 34px;
          padding: 0;
          border-radius: 8px;
          font-size: 14px;
        }

        .gv-ai-delete-button:hover {
          border-color: rgba(
            248,
            113,
            113,
            0.55
          );
          background: rgba(
            239,
            68,
            68,
            0.1
          );
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

        .gv-ai-rename-box {
          width: 100%;
          display: grid;
          gap: 8px;
          padding: 7px;
        }

        .gv-ai-rename-box input {
          width: 100%;
          min-height: 40px;
          box-sizing: border-box;
          padding: 0 11px;
          border: 1px solid
            rgba(255, 255, 255, 0.12);
          border-radius: 9px;
          outline: none;
          background: rgba(
            0,
            0,
            0,
            0.2
          );
          color: #fff;
          font: inherit;
        }

        .gv-ai-rename-box input:focus {
          border-color: rgba(
            34,
            211,
            238,
            0.55
          );
        }

        .gv-ai-rename-actions {
          display: flex;
          gap: 7px;
        }

        .gv-ai-save,
        .gv-ai-cancel {
          min-height: 34px;
          padding: 0 11px;
          border-radius: 8px;
          font-size: 12px;
          font-weight: 800;
        }

        .gv-ai-save {
          border-color: rgba(
            34,
            197,
            94,
            0.35
          );
          background: rgba(
            34,
            197,
            94,
            0.08
          );
        }

        .gv-ai-cancel {
          border-color: rgba(
            255,
            255,
            255,
            0.1
          );
        }

        .gv-ai-message-actions {
          display: flex;
          align-items: center;
          justify-content: flex-start;
          flex-wrap: wrap;
          gap: 7px;
          margin-top: 9px;
        }

        .gv-ai-copy,
        .gv-ai-regenerate {
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

        .gv-ai-regenerate {
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
            0.08
          );
        }

        .gv-ai-regenerating {
          margin-top: 8px;
          color: rgba(
            168,
            85,
            247,
            0.95
          );
          font-size: 12px;
          font-weight: 700;
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

          .gv-ai-history-item-wrapper {
            align-items: stretch;
          }

          .gv-ai-history-item {
            align-items: flex-start;
            flex-direction: column;
            justify-content: center;
            gap: 4px;
          }

          .gv-ai-history-count {
            font-size: 10px;
          }

          .gv-ai-history-actions {
            padding-right: 3px;
          }

          .gv-ai-message-actions {
            gap: 6px;
          }

          .gv-ai-copy,
          .gv-ai-regenerate {
            min-height: 34px;
            padding: 0 11px;
          }
        }

        @media (max-width: 420px) {
          .gv-ai-toolbar {
            grid-template-columns: 1fr;
          }

          .gv-ai-history-item-wrapper {
            flex-wrap: wrap;
          }

          .gv-ai-history-item {
            flex: 1 1 calc(100% - 82px);
          }

          .gv-ai-history-actions {
            flex: 0 0 auto;
          }

          .gv-ai-rename-box {
            padding: 5px;
          }

          .gv-ai-message-actions {
            width: 100%;
          }

          .gv-ai-copy,
          .gv-ai-regenerate {
            flex: 1 1 auto;
          }
        }
      `}</style>
    </section>
  );
        }
