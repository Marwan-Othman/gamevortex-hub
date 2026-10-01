"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import styles from "./ai.module.css";

import {
  useLocale,
} from "@/components/ui/useLocale";

type Conversation = {
  id: string;
  title: string;
  updatedAt?: string;
};

type Message = {
  id?: string;
  role: string;
  content: string;
};

type MediaJob = {
  id: string;
  kind: "IMAGE" | "VIDEO";
  status:
    | "QUEUED"
    | "PROCESSING"
    | "COMPLETED"
    | "FAILED";
  prompt: string;
  resultUrl?: string | null;
  errorMessage?: string | null;
  createdAt?: string;
};

type AiRequestError =
  Error & {
    requestId?: string;
  };

type Mode =
  | "CHAT"
  | "IMAGE"
  | "VIDEO"
  | "VOICE";

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;

  onresult:
    | ((
        event: {
          results: ArrayLike<{
            0: {
              transcript: string;
            };
          }>;
        },
      ) => void)
    | null;

  onerror:
    | (() => void)
    | null;

  onend:
    | (() => void)
    | null;

  start: () => void;
  stop: () => void;
};

type SpeechRecognitionCtor =
  new () => SpeechRecognitionLike;

const VOICE_TONES = {
  natural: {
    pitch: 1,
    rate: 1,
  },

  calm: {
    pitch: 0.92,
    rate: 0.9,
  },

  friendly: {
    pitch: 1.08,
    rate: 1.02,
  },

  professional: {
    pitch: 0.98,
    rate: 0.96,
  },

  energetic: {
    pitch: 1.16,
    rate: 1.1,
  },
} as const;

type Tone =
  keyof typeof VOICE_TONES;

function inlineMarkdown(
  text: string,
) {
  return text
    .split(
      /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g,
    )
    .map(
      (part, index) => {
        if (
          part.startsWith("`") &&
          part.endsWith("`")
        ) {
          return (
            <code key={index}>
              {part.slice(
                1,
                -1,
              )}
            </code>
          );
        }

        if (
          part.startsWith("**") &&
          part.endsWith("**")
        ) {
          return (
            <strong key={index}>
              {part.slice(
                2,
                -2,
              )}
            </strong>
          );
        }

        if (
          part.startsWith("*") &&
          part.endsWith("*")
        ) {
          return (
            <em key={index}>
              {part.slice(
                1,
                -1,
              )}
            </em>
          );
        }

        return part;
      },
    );
}

function errorMessage(
  code: string,
  english: boolean,
) {
  const messages: Record<
    string,
    [string, string]
  > = {
    UNAUTHORIZED: [
      "انتهت جلسة الدخول. سجّل الدخول مجددًا.",
      "Your session has expired. Sign in again.",
    ],

    CONVERSATION_NOT_FOUND: [
      "لم يتم العثور على المحادثة.",
      "Conversation not found.",
    ],

    RUNTIME_EMPTY_RESPONSE: [
      "لم يُرجع النموذج أي نص.",
      "The model returned no text.",
    ],

    RUNTIME_INVALID_RESPONSE: [
      "أرسل خادم AI استجابة غير مفهومة.",
      "The AI runtime returned an invalid response.",
    ],

    RUNTIME_STREAM_FAILED: [
      "انقطع التوليد قبل اكتماله. أعد المحاولة.",
      "Generation stopped before it finished. Try again.",
    ],

    RUNTIME_HTTP_ERROR: [
      "أعاد خادم AI خطأ. أعد المحاولة.",
      "The AI runtime returned an error. Try again.",
    ],

    RUNTIME_AUTH_FAILED: [
      "مفتاح Gemini غير مقبول من الخدمة.",
      "Gemini rejected the API key.",
    ],

    RUNTIME_UNREACHABLE: [
      "تعذر الوصول إلى Gemini حاليًا.",
      "Gemini could not be reached right now.",
    ],

    GEMINI_IMAGE_BILLING_REQUIRED: [
      "توليد الصور في Gemini API يحتاج تفعيل الفوترة. الدردشة النصية قد تعمل بدون ذلك، لكن صور Gemini ليست ضمن الخطة المجانية الحالية.",
      "Gemini API image generation requires billing. Text chat may work on the free tier, but Gemini image generation is not included in the current API free tier.",
    ],

    GEMINI_RATE_LIMITED: [
      "تم الوصول إلى حد الطلبات. انتظر قليلًا ثم أعد المحاولة.",
      "The image API rate limit was reached. Wait a little and try again.",
    ],

    GEMINI_IMAGE_TIMEOUT: [
      "استغرق توليد الصورة وقتًا أطول من المسموح.",
      "Image generation timed out.",
    ],

    GEMINI_IMAGE_NOT_RETURNED: [
      "Gemini لم يُرجع ملف صورة في الاستجابة.",
      "Gemini did not return an image in its response.",
    ],

    GEMINI_IMAGE_GENERATION_FAILED: [
      "فشل توليد الصورة من Gemini.",
      "Gemini image generation failed.",
    ],

    GEMINI_INVALID_RESPONSE: [
      "استجابة Gemini للصور غير صالحة.",
      "Gemini returned an invalid image response.",
    ],

    AI_IMAGE_PROMPT_REQUIRED: [
      "اكتب وصف الصورة أولًا.",
      "Enter an image prompt first.",
    ],

    AI_IMAGE_TYPE_NOT_SUPPORTED: [
      "نوع الصورة غير مدعوم. استخدم PNG أو JPG أو WEBP أو GIF.",
      "Unsupported image type. Use PNG, JPG, WEBP or GIF.",
    ],

    AI_IMAGE_TOO_LARGE: [
      "حجم الصورة كبير جدًا. الحد الأقصى 10MB.",
      "The image is too large. The maximum size is 10MB.",
    ],

    AI_VIDEO_GENERATION_NOT_ENABLED: [
      "الفيديو مؤجل حاليًا. سنفعّله بعد إنهاء نظام الصور.",
      "Video generation is intentionally paused until the image system is finished.",
    ],

    AI_SERVICE_UNAVAILABLE: [
      "تعذر إكمال الطلب حاليًا.",
      "The request could not be completed right now.",
    ],
  };

  return (
    messages[code]?.[
      english ? 1 : 0
    ] ||
    messages
      .AI_SERVICE_UNAVAILABLE[
        english ? 1 : 0
      ]
  );
}

export default function AiHubClient() {
  const locale =
    useLocale();

  const english =
    locale === "en";

  const [mode, setMode] =
    useState<Mode>("CHAT");

  const [items, setItems] =
    useState<Conversation[]>(
      [],
    );

  const [active, setActive] =
    useState("");

  const [messages, setMessages] =
    useState<Message[]>([]);

  const [media, setMedia] =
    useState<MediaJob[]>([]);

  const [prompt, setPrompt] =
    useState("");

  const [busy, setBusy] =
    useState(false);

  const [mediaBusy, setMediaBusy] =
    useState<
      "IMAGE" | null
    >(null);

  const [error, setError] =
    useState("");

  const [listening, setListening] =
    useState(false);

  const [speaking, setSpeaking] =
    useState(false);

  const [voiceAutoSpeak, setVoiceAutoSpeak] =
    useState(true);

  const [handsFree, setHandsFree] =
    useState(false);

  const [tone, setTone] =
    useState<Tone>("natural");

  const [speechSpeed, setSpeechSpeed] =
    useState("1");

  const [selectedVoice, setSelectedVoice] =
    useState("");

  const [voices, setVoices] =
    useState<
      SpeechSynthesisVoice[]
    >([]);

  const [aspectRatio, setAspectRatio] =
    useState("1:1");

  const [imageFile, setImageFile] =
    useState<File | null>(null);

  const aborter =
    useRef<AbortController | null>(
      null,
    );

  const recognition =
    useRef<SpeechRecognitionLike | null>(
      null,
    );

  const bottom =
    useRef<HTMLDivElement | null>(
      null,
    );

  const t = (
    ar: string,
    en: string,
  ) =>
    english ? en : ar;

  const speechLang =
    useMemo(() => {
      if (
        typeof navigator ===
        "undefined"
      ) {
        return english
          ? "en-US"
          : "ar-SA";
      }

      const language =
        navigator.language ||
        (english
          ? "en-US"
          : "ar-SA");

      return english
        ? language
        : language.startsWith(
            "ar",
          )
          ? language
          : "ar-SA";
    }, [english]);

  useEffect(() => {
    if (
      typeof window ===
        "undefined" ||
      !(
        "speechSynthesis" in
        window
      )
    ) {
      return;
    }

    const loadVoices =
      () => {
        const available =
          window.speechSynthesis.getVoices();

        setVoices(
          available,
        );

        if (
          !selectedVoice &&
          available.length
        ) {
          const preferred =
            available.find(
              (voice) =>
                voice.lang
                  .toLowerCase()
                  .startsWith(
                    english
                      ? "en"
                      : "ar",
                  ),
            );

          setSelectedVoice(
            (
              preferred ||
              available[0]
            ).name,
          );
        }
      };

    loadVoices();

    window.speechSynthesis.addEventListener(
      "voiceschanged",
      loadVoices,
    );

    return () =>
      window.speechSynthesis.removeEventListener(
        "voiceschanged",
        loadVoices,
      );
  }, [
    english,
    selectedVoice,
  ]);

  async function refresh() {
    try {
      const response =
        await fetch(
          "/api/gamevortex-ai/conversations",
          {
            cache:
              "no-store",
          },
        );

      if (!response.ok) {
        throw new Error(
          "AI_SERVICE_UNAVAILABLE",
        );
      }

      const result =
        await response.json();

      const next =
        Array.isArray(
          result.data,
        )
          ? result.data
          : [];

      setItems(next);

      if (
        !active &&
        next[0]?.id
      ) {
        await open(
          next[0].id,
        );
      }
    } catch {
      setError(
        errorMessage(
          "AI_SERVICE_UNAVAILABLE",
          english,
        ),
      );
    }
  }

  async function refreshMedia(
    conversationId = active,
  ) {
    if (!conversationId) {
      return;
    }

    try {
      const response =
        await fetch(
          `/api/ai/media?conversationId=${encodeURIComponent(
            conversationId,
          )}`,
          {
            cache:
              "no-store",
          },
        );

      if (!response.ok) {
        return;
      }

      const result =
        await response.json();

      setMedia(
        Array.isArray(
          result.jobs,
        )
          ? result.jobs
          : [],
      );
    } catch {
      // Media history is intentionally non-blocking.
    }
  }

  async function open(
    id: string,
  ) {
    try {
      const response =
        await fetch(
          `/api/gamevortex-ai/conversations/${id}`,
        );

      if (!response.ok) {
        setError(
          errorMessage(
            response.status ===
              401
              ? "UNAUTHORIZED"
              : "AI_SERVICE_UNAVAILABLE",
            english,
          ),
        );

        return;
      }

      const { data } =
        await response.json();

      setActive(id);

      setMessages(
        Array.isArray(
          data.messages,
        )
          ? data.messages
          : [],
      );

      setError("");

      await refreshMedia(
        id,
      );
    } catch {
      setError(
        errorMessage(
          "AI_SERVICE_UNAVAILABLE",
          english,
        ),
      );
    }
  }

  async function create() {
    try {
      const response =
        await fetch(
          "/api/gamevortex-ai/conversations",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              "{}",
          },
        );

      if (!response.ok) {
        throw new Error(
          response.status ===
            401
            ? "UNAUTHORIZED"
            : "AI_SERVICE_UNAVAILABLE",
        );
      }

      const { data } =
        await response.json();

      setMessages([]);

      setMedia([]);

      setActive(
        data.id,
      );

      setError("");

      await refresh();
    } catch (e) {
      setError(
        errorMessage(
          e instanceof Error
            ? e.message
            : "AI_SERVICE_UNAVAILABLE",
          english,
        ),
      );
    }
  }

  async function remove(
    id: string,
  ) {
    try {
      const response =
        await fetch(
          `/api/gamevortex-ai/conversations/${id}`,
          {
            method:
              "DELETE",
          },
        );

      if (!response.ok) {
        throw new Error(
          response.status ===
            401
            ? "UNAUTHORIZED"
            : "AI_SERVICE_UNAVAILABLE",
        );
      }

      const next =
        items.filter(
          (item) =>
            item.id !== id,
        );

      setItems(next);

      if (
        active === id
      ) {
        setActive("");

        setMessages([]);

        setMedia([]);

        if (next[0]) {
          await open(
            next[0].id,
          );
        }
      }
    } catch (e) {
      setError(
        errorMessage(
          e instanceof Error
            ? e.message
            : "AI_SERVICE_UNAVAILABLE",
          english,
        ),
      );
    }
  }

  async function rename(
    item: Conversation,
  ) {
    const title =
      window.prompt(
        t(
          "اسم المحادثة",
          "Conversation title",
        ),
        item.title,
      );

    if (!title?.trim()) {
      return;
    }

    const response =
      await fetch(
        `/api/gamevortex-ai/conversations/${item.id}`,
        {
          method:
            "PATCH",

          headers: {
            "Content-Type":
              "application/json",
          },

          body:
            JSON.stringify({
              title,
            }),
        },
      );

    if (!response.ok) {
      setError(
        errorMessage(
          "AI_SERVICE_UNAVAILABLE",
          english,
        ),
      );
    } else {
      await refresh();
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView(
      {
        behavior:
          "smooth",
      },
    );
  }, [
    messages,
    media,
  ]);

  function speakText(
    text: string,
    after?: () => void,
  ) {
    if (
      !text.trim() ||
      typeof window ===
        "undefined" ||
      !(
        "speechSynthesis" in
        window
      )
    ) {
      return;
    }

    window.speechSynthesis.cancel();

    const utterance =
      new SpeechSynthesisUtterance(
        text,
      );

    utterance.lang =
      speechLang;

    utterance.pitch =
      VOICE_TONES[tone]
        .pitch;

    utterance.rate =
      Number(
        speechSpeed,
      ) *
      VOICE_TONES[tone]
        .rate;

    const voice =
      voices.find(
        (item) =>
          item.name ===
          selectedVoice,
      );

    if (voice) {
      utterance.voice =
        voice;
    }

    utterance.onstart =
      () =>
        setSpeaking(
          true,
        );

    utterance.onend =
      () => {
        setSpeaking(
          false,
        );

        after?.();
      };

    utterance.onerror =
      () => {
        setSpeaking(
          false,
        );

        after?.();
      };

    window.speechSynthesis.speak(
      utterance,
    );
  }

  async function send(
    text = prompt,
    regenerate = false,
  ) {
    const cleanPrompt =
      text.trim();

    if (
      !cleanPrompt ||
      busy
    ) {
      return;
    }

    setError("");

    let conversationId =
      active;

    if (!conversationId) {
      try {
        const response =
          await fetch(
            "/api/gamevortex-ai/conversations",
            {
              method:
                "POST",

              headers: {
                "Content-Type":
                  "application/json",
              },

              body:
                "{}",
            },
          );

        if (!response.ok) {
          throw new Error(
            response.status ===
              401
              ? "UNAUTHORIZED"
              : "AI_SERVICE_UNAVAILABLE",
          );
        }

        const { data } =
          await response.json();

        conversationId =
          data.id;

        setActive(
          conversationId,
        );

        void refresh();
      } catch (e) {
        setError(
          errorMessage(
            e instanceof Error
              ? e.message
              : "AI_SERVICE_UNAVAILABLE",
            english,
          ),
        );

        return;
      }
    }

    const assistant: Message =
      {
        role:
          "assistant",
        content:
          "",
      };

    if (regenerate) {
      setMessages(
        (current) => [
          ...current.slice(
            0,
            -1,
          ),
          assistant,
        ],
      );
    } else {
      setMessages(
        (current) => [
          ...current,

          {
            role:
              "user",
            content:
              cleanPrompt,
          },

          assistant,
        ],
      );
    }

    setPrompt("");

    setBusy(true);

    const controller =
      new AbortController();

    aborter.current =
      controller;

    try {
      const response =
        await fetch(
          "/api/gamevortex-ai/chat",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                conversationId,
                prompt:
                  cleanPrompt,
                regenerate,
              }),

            signal:
              controller.signal,
          },
        );

      if (!response.ok) {
        const body =
          await response
            .json()
            .catch(
              () => ({}),
            );

        const requestError =
          new Error(
            body.error ||
              `HTTP_${response.status}`,
          ) as AiRequestError;

        requestError.requestId =
          body.requestId ||
          response.headers.get(
            "x-request-id",
          ) ||
          undefined;

        throw requestError;
      }

      const reader =
        response.body?.getReader();

      if (!reader) {
        throw new Error(
          "RUNTIME_INVALID_RESPONSE",
        );
      }

      const decoder =
        new TextDecoder();

      while (true) {
        const {
          value,
          done,
        } =
          await reader.read();

        if (done) {
          break;
        }

        assistant.content +=
          decoder.decode(
            value,
            {
              stream: true,
            },
          );

        setMessages(
          (current) => [
            ...current.slice(
              0,
              -1,
            ),

            {
              ...assistant,
            },
          ],
        );
      }

      assistant.content +=
        decoder.decode();

      setMessages(
        (current) => [
          ...current.slice(
            0,
            -1,
          ),

          {
            ...assistant,
          },
        ],
      );

      await refreshMedia(
        conversationId,
      );

      await refresh();

      if (
        mode === "VOICE" &&
        voiceAutoSpeak &&
        assistant.content
      ) {
        speakText(
          assistant.content,
          handsFree
            ? () =>
                window.setTimeout(
                  startVoice,
                  250,
                )
            : undefined,
        );
      }
    } catch (e) {
      if (
        e instanceof DOMException &&
        e.name ===
          "AbortError"
      ) {
        return;
      }

      setMessages(
        (current) =>
          current.filter(
            (message) =>
              message !==
              assistant,
          ),
      );

      setError(
        errorMessage(
          e instanceof Error
            ? e.message
            : "AI_SERVICE_UNAVAILABLE",
          english,
        ),
      );
    } finally {
      setBusy(false);

      aborter.current =
        null;
    }
  }

  async function ensureConversation() {
    if (active) {
      return active;
    }

    const response =
      await fetch(
        "/api/gamevortex-ai/conversations",
        {
          method:
            "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body:
            "{}",
        },
      );

    if (!response.ok) {
      throw new Error(
        response.status ===
          401
          ? "UNAUTHORIZED"
          : "AI_SERVICE_UNAVAILABLE",
      );
    }

    const { data } =
      await response.json();

    setActive(
      data.id,
    );

    void refresh();

    return data.id as string;
  }

  async function generateImage() {
    const text =
      prompt.trim();

    if (
      !text ||
      mediaBusy
    ) {
      return;
    }

    setMediaBusy(
      "IMAGE",
    );

    setError("");

    try {
      const conversationId =
        await ensureConversation();

      const form = new FormData();
      form.set("kind", "IMAGE");
      form.set("prompt", text);
      form.set("aspectRatio", aspectRatio);
      form.set("conversationId", conversationId);
      form.set("idempotencyKey", crypto.randomUUID());
      if (imageFile) form.set("image", imageFile);

      const response =
        await fetch(
          "/api/ai/media",
          {
            method: "POST",
            body: form,
          },
        );

      const body =
        await response
          .json()
          .catch(
            () => ({}),
          );

      if (!response.ok) {
        throw new Error(
          body.error ||
            "AI_SERVICE_UNAVAILABLE",
        );
      }

      setPrompt("");
      setImageFile(null);

      await refreshMedia(
        conversationId,
      );
    } catch (e) {
      setError(
        errorMessage(
          e instanceof Error
            ? e.message
            : "AI_SERVICE_UNAVAILABLE",
          english,
        ),
      );
    } finally {
      setMediaBusy(
        null,
      );
    }
  }

  async function deleteMedia(
    id: string,
  ) {
    const response =
      await fetch(
        `/api/ai/media/${id}`,
        {
          method:
            "DELETE",
        },
      );

    if (!response.ok) {
      setError(
        errorMessage(
          "AI_SERVICE_UNAVAILABLE",
          english,
        ),
      );

      return;
    }

    setMedia(
      (current) =>
        current.filter(
          (item) =>
            item.id !== id,
        ),
    );
  }

  function startVoice() {
    if (listening) {
      return;
    }

    const SpeechRecognition =
      (
        window as Window & {
          SpeechRecognition?: SpeechRecognitionCtor;

          webkitSpeechRecognition?: SpeechRecognitionCtor;
        }
      ).SpeechRecognition ||
      (
        window as Window & {
          webkitSpeechRecognition?: SpeechRecognitionCtor;
        }
      )
        .webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setError(
        t(
          "المتصفح الحالي لا يدعم التعرف على الصوت. جرّب Chrome على الهاتف أو الكمبيوتر.",
          "This browser does not support speech recognition. Try Chrome on your phone or computer.",
        ),
      );

      return;
    }

    const instance =
      new SpeechRecognition();

    instance.lang =
      speechLang;

    instance.continuous =
      false;

    instance.interimResults =
      false;

    instance.onresult =
      (event) => {
        const transcript =
          event.results[0]?.[0]
            ?.transcript ||
          "";

        if (!transcript) {
          return;
        }

        setPrompt(
          transcript,
        );

        if (
          mode === "VOICE" &&
          handsFree
        ) {
          window.setTimeout(
            () =>
              void send(
                transcript,
              ),
            80,
          );
        }
      };

    instance.onerror =
      () =>
        setListening(
          false,
        );

    instance.onend =
      () =>
        setListening(
          false,
        );

    recognition.current =
      instance;

    setListening(true);

    instance.start();
  }

  function stopVoice() {
    recognition.current?.stop();

    recognition.current =
      null;

    setListening(false);
  }

  function speakLatest() {
    const text =
      [...messages]
        .reverse()
        .find(
          (message) =>
            message.role ===
            "assistant",
        )
        ?.content;

    if (text) {
      speakText(text);
    }
  }

  useEffect(
    () => () => {
      recognition.current?.stop();

      window.speechSynthesis?.cancel();
    },
    [],
  );

  const visibleMedia =
    media.filter(
      (job) =>
        job.kind ===
        "IMAGE",
    );

  const modes: Array<{
    id: Mode;
    icon: string;
    ar: string;
    en: string;
  }> = [
    {
      id: "CHAT",
      icon: "✦",
      ar: "الدردشة",
      en: "Chat",
    },

    {
      id: "IMAGE",
      icon: "▧",
      ar: "الصور",
      en: "Images",
    },

    {
      id: "VIDEO",
      icon: "▶",
      ar: "الفيديو",
      en: "Video",
    },

    {
      id: "VOICE",
      icon: "◉",
      ar: "الصوت",
      en: "Voice",
    },
  ];

  return (
    <main
      className={
        styles.aiHub
      }
      dir={
        english
          ? "ltr"
          : "rtl"
      }
    >
      <header
        className={
          styles.header
        }
      >
        <div>
          <span
            className={
              styles.kicker
            }
          >
            GAMEVORTEX AI
          </span>

          <h1>
            {t(
              "مركز الذكاء الاصطناعي",
              "AI Hub",
            )}
          </h1>

          <p>
            {t(
              "اختر الوضع الذي تريده بدل خلط الدردشة والصور والفيديو في زر واحد.",
              "Choose a dedicated mode instead of mixing chat, images and video into one control.",
            )}
          </p>
        </div>

        <button
          className={
            styles.primaryButton
          }
          onClick={() =>
            void create()
          }
        >
          {t(
            "محادثة جديدة",
            "New chat",
          )}
        </button>
      </header>

      <nav
        className={
          styles.modeBar
        }
        aria-label={t(
          "أوضاع الذكاء الاصطناعي",
          "AI modes",
        )}
      >
        {modes.map(
          (item) => (
            <button
              key={
                item.id
              }
              className={`${styles.modeButton} ${
                mode ===
                item.id
                  ? styles.modeActive
                  : ""
              } ${
                item.id ===
                "VIDEO"
                  ? styles.videoMode
                  : ""
              }`}
              onClick={() => {
                setMode(
                  item.id,
                );

                setError(
                  "",
                );
              }}
            >
              <span>
                {
                  item.icon
                }
              </span>

              <strong>
                {t(
                  item.ar,
                  item.en,
                )}
              </strong>

              {item.id ===
                "VIDEO" && (
                <small>
                  {t(
                    "لاحقًا",
                    "Later",
                  )}
                </small>
              )}
            </button>
          ),
        )}
      </nav>

      {error && (
        <div
          className={
            styles.notice
          }
        >
          {error}
        </div>
      )}

      <section
        className={
          styles.workArea
        }
      >
        <aside
          className={
            styles.sidebar
          }
        >
          <div
            className={
              styles.sidebarHead
            }
          >
            <h3>
              {t(
                "المحادثات",
                "Conversations",
              )}
            </h3>

            <button
              onClick={() =>
                void create()
              }
              aria-label={t(
                "محادثة جديدة",
                "New chat",
              )}
            >
              ＋
            </button>
          </div>

          {items.map(
            (item) => (
              <div
                className={`${styles.historyRow} ${
                  active ===
                  item.id
                    ? styles.activeRow
                    : ""
                }`}
                key={
                  item.id
                }
              >
                <button
                  onClick={() =>
                    void open(
                      item.id,
                    )
                  }
                >
                  {
                    item.title
                  }
                </button>

                <button
                  onClick={() =>
                    void rename(
                      item,
                    )
                  }
                  aria-label={t(
                    "تعديل",
                    "Rename",
                  )}
                >
                  ✎
                </button>

                <button
                  onClick={() =>
                    void remove(
                      item.id,
                    )
                  }
                  aria-label={t(
                    "حذف",
                    "Delete",
                  )}
                >
                  ×
                </button>
              </div>
            ),
          )}

          {!items.length && (
            <p
              className={
                styles.emptySide
              }
            >
              {t(
                "لا توجد محادثات بعد.",
                "No conversations yet.",
              )}
            </p>
          )}
        </aside>

        <div
          className={
            styles.chatPanel
          }
        >
          <div
            className={
              styles.modeHeader
            }
          >
            <div>
              <span>
                {
                  modes.find(
                    (item) =>
                      item.id ===
                      mode,
                  )?.icon
                }
              </span>

              <strong>
                {t(
                  mode ===
                    "CHAT"
                    ? "محادثة GameVortex AI"
                    : mode ===
                        "IMAGE"
                      ? "تصميم الصور بالذكاء الاصطناعي"
                      : mode ===
                          "VIDEO"
                        ? "توليد الفيديو"
                        : "المحادثة الصوتية",

                  mode ===
                    "CHAT"
                    ? "GameVortex AI Chat"
                    : mode ===
                        "IMAGE"
                      ? "AI Image Studio"
                      : mode ===
                          "VIDEO"
                        ? "AI Video"
                        : "Voice Chat",
                )}
              </strong>
            </div>

            {mode ===
              "CHAT" && (
              <span
                className={
                  styles.knowledgeBadge
                }
              >
                {t(
                  "متصل ببيانات GameVortex",
                  "Connected to GameVortex data",
                )}
              </span>
            )}
          </div>

          {mode ===
          "VIDEO" ? (
            <div
              className={
                styles.comingSoon
              }
            >
              <div
                className={
                  styles.videoIcon
                }
              >
                ▶
              </div>

              <h2>
                {t(
                  "الفيديو مؤجل حاليًا",
                  "Video is paused for now",
                )}
              </h2>

              <p>
                {t(
                  "لن نخلط نظام الفيديو مع الصور. سنعود إليه بعد إنهاء توليد الصور واختباره بالكامل.",
                  "Video stays separate. We will return to it after image generation is finished and tested.",
                )}
              </p>

              <button
                onClick={() =>
                  setMode(
                    "IMAGE",
                  )
                }
              >
                {t(
                  "الانتقال إلى الصور",
                  "Go to Images",
                )}
              </button>
            </div>
          ) : mode ===
            "IMAGE" ? (
            <div
              className={
                styles.imageStudio
              }
            >
              <div
                className={
                  styles.studioIntro
                }
              >
                <div
                  className={
                    styles.studioOrb
                  }
                >
                  ✦
                </div>

                <div>
                  <h2>
                    {t(
                      "صمّم صورتك",
                      "Create your image",
                    )}
                  </h2>

                  <p>
                    {t(
                      "اكتب وصفًا واضحًا للصورة أو ارفع صورة لتعديلها. الطلب يمر إلى Gemini من الخادم بدون كشف المفتاح للمتصفح.",
                      "Describe an image or upload one to edit it. The request is sent to Gemini server-side without exposing the API key to the browser.",
                    )}
                  </p>
                </div>
              </div>

              <div
                className={
                  styles.optionGrid
                }
              >
                <label>
                  <span>
                    {t(
                      "نسبة الصورة",
                      "Aspect ratio",
                    )}
                  </span>

                  <select
                    value={
                      aspectRatio
                    }
                    onChange={(
                      event,
                    ) =>
                      setAspectRatio(
                        event
                          .target
                          .value,
                      )
                    }
                  >
                    <option value="1:1">
                      1:1
                    </option>

                    <option value="16:9">
                      16:9
                    </option>

                    <option value="9:16">
                      9:16
                    </option>

                    <option value="4:3">
                      4:3
                    </option>

                    <option value="3:4">
                      3:4
                    </option>

                    <option value="3:2">
                      3:2
                    </option>

                    <option value="2:3">
                      2:3
                    </option>

                    <option value="21:9">
                      21:9
                    </option>
                  </select>
                </label>
              </div>

              <label className={styles.optionGrid} style={{ cursor: "pointer" }}>
                <span>{t("رفع صورة للتعديل", "Upload an image to edit")}</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={(event) => setImageFile(event.target.files?.[0] || null)}
                />
                {imageFile ? (
                  <span className="muted">{imageFile.name} · {(imageFile.size / 1024 / 1024).toFixed(2)} MB</span>
                ) : null}
              </label>

              <div
                className={
                  styles.imagePromptBox
                }
              >
                <textarea
                  value={
                    prompt
                  }
                  onChange={(
                    event,
                  ) =>
                    setPrompt(
                      event
                        .target
                        .value,
                    )
                  }
                  placeholder={t(
                    "مثال: شخصية لاعب ألعاب مستقبلية داخل مدينة نيون، أسلوب سينمائي واقعي، إضاءة بنفسجية وزرقاء...",
                    "Example: a futuristic gamer inside a neon city, cinematic realistic style, purple and blue lighting...",
                  )}
                  onKeyDown={(
                    event,
                  ) => {
                    if (
                      event.key ===
                        "Enter" &&
                      (event.ctrlKey ||
                        event.metaKey)
                    ) {
                      event.preventDefault();

                      void generateImage();
                    }
                  }}
                />

                <button
                  onClick={() =>
                    void generateImage()
                  }
                  disabled={
                    !prompt.trim() ||
                    !!mediaBusy
                  }
                >
                  {mediaBusy ===
                  "IMAGE"
                    ? t(
                        "جاري التصميم...",
                        "Generating...",
                      )
                    : t(
                        "إنشاء الصورة",
                        "Generate image",
                      )}
                </button>
              </div>

              <div
                className={
                  styles.mediaGrid
                }
              >
                {visibleMedia.map(
                  (job) => (
                    <article
                      className={
                        styles.mediaCard
                      }
                      key={
                        job.id
                      }
                    >
                      <div
                        className={
                          styles.mediaMeta
                        }
                      >
                        <span>
                          {t(
                            "صورة AI",
                            "AI Image",
                          )}
                        </span>

                        <button
                          onClick={() =>
                            void deleteMedia(
                              job.id,
                            )
                          }
                          aria-label={t(
                            "حذف الصورة",
                            "Delete image",
                          )}
                        >
                          ×
                        </button>
                      </div>

                      {job.status !==
                        "COMPLETED" && (
                        <div
                          className={
                            styles.mediaStatus
                          }
                        >
                          {job.status ===
                          "FAILED"
                            ? job.errorMessage ||
                              t(
                                "فشل الإنشاء",
                                "Generation failed",
                              )
                            : t(
                                "جاري الإنشاء…",
                                "Generating…",
                              )}
                        </div>
                      )}

                      {job.status ===
                        "COMPLETED" &&
                        job.resultUrl && (
                          <>
                          <img
                            src={
                              job.resultUrl
                            }
                            alt={
                              job.prompt
                            }
                            className={
                              styles.mediaResult
                            }
                          />
                          <a
                            className="btn"
                            href={job.resultUrl}
                            download={`gamevortex-ai-${job.id}.png`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {t("حفظ / تنزيل", "Save / Download")}
                          </a>
                          </>
                        )}

                      <p>
                        {
                          job.prompt
                        }
                      </p>
                    </article>
                  ),
                )}

                {!visibleMedia.length && (
                  <div
                    className={
                      styles.emptyMedia
                    }
                  >
                    {t(
                      "ستظهر الصور التي تنشئها هنا.",
                      "Your generated images will appear here.",
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : mode ===
            "VOICE" ? (
            <div
              className={
                styles.voiceModePanel
              }
            >
              <div
                className={`${styles.voiceOrb} ${
                  listening
                    ? styles.listening
                    : speaking
                      ? styles.speaking
                      : ""
                }`}
              >
                <span>
                  {listening
                    ? "◉"
                    : speaking
                      ? "✦"
                      : "🎙"}
                </span>
              </div>

              <h2>
                {listening
                  ? t(
                      "أستمع إليك...",
                      "Listening...",
                    )
                  : speaking
                    ? t(
                        "GameVortex AI يتحدث...",
                        "GameVortex AI is speaking...",
                      )
                    : t(
                        "تحدث مع GameVortex AI",
                        "Talk to GameVortex AI",
                      )}
              </h2>

              <p>
                {t(
                  "تحدث، وسيتم تحويل كلامك إلى رسالة وإرسالها للمحادثة. يمكنك تشغيل الرد صوتيًا وتغيير الصوت والنبرة والسرعة.",
                  "Speak naturally, send the transcription to chat, and control the reply voice, tone and speed.",
                )}
              </p>

              <div
                className={
                  styles.voiceControls
                }
              >
                <button
                  className={
                    styles.voiceMainButton
                  }
                  onClick={
                    listening
                      ? stopVoice
                      : startVoice
                  }
                >
                  {listening
                    ? "■"
                    : "🎙"}
                </button>

                <button
                  onClick={
                    speakLatest
                  }
                  disabled={
                    speaking
                  }
                >
                  🔊
                </button>

                <button
                  onClick={() => {
                    window.speechSynthesis?.cancel();

                    setSpeaking(
                      false,
                    );
                  }}
                >
                  ■
                </button>
              </div>

              <div
                className={
                  styles.voiceSettings
                }
              >
                <label>
                  <span>
                    {t(
                      "الصوت",
                      "Voice",
                    )}
                  </span>

                  <select
                    value={
                      selectedVoice
                    }
                    onChange={(
                      event,
                    ) =>
                      setSelectedVoice(
                        event
                          .target
                          .value,
                      )
                    }
                  >
                    {voices.length
                      ? voices.map(
                          (
                            voice,
                          ) => (
                            <option
                              key={`${voice.name}-${voice.lang}`}
                              value={
                                voice.name
                              }
                            >
                              {
                                voice.name
                              }{" "}
                              ·{" "}
                              {
                                voice.lang
                              }
                            </option>
                          ),
                        )
                      : (
                        <option value="">
                          {t(
                            "صوت المتصفح الافتراضي",
                            "Browser default",
                          )}
                        </option>
                      )}
                  </select>
                </label>

                <label>
                  <span>
                    {t(
                      "النبرة",
                      "Tone",
                    )}
                  </span>

                  <select
                    value={
                      tone
                    }
                    onChange={(
                      event,
                    ) =>
                      setTone(
                        event
                          .target
                          .value as Tone,
                      )
                    }
                  >
                    <option value="natural">
                      {t(
                        "طبيعية",
                        "Natural",
                      )}
                    </option>

                    <option value="calm">
                      {t(
                        "هادئة",
                        "Calm",
                      )}
                    </option>

                    <option value="friendly">
                      {t(
                        "ودودة",
                        "Friendly",
                      )}
                    </option>

                    <option value="professional">
                      {t(
                        "احترافية",
                        "Professional",
                      )}
                    </option>

                    <option value="energetic">
                      {t(
                        "حماسية",
                        "Energetic",
                      )}
                    </option>
                  </select>
                </label>

                <label>
                  <span>
                    {t(
                      "السرعة",
                      "Speed",
                    )}
                  </span>

                  <select
                    value={
                      speechSpeed
                    }
                    onChange={(
                      event,
                    ) =>
                      setSpeechSpeed(
                        event
                          .target
                          .value,
                      )
                    }
                  >
                    <option value="0.75">
                      0.75×
                    </option>

                    <option value="0.9">
                      0.90×
                    </option>

                    <option value="1">
                      1.00×
                    </option>

                    <option value="1.15">
                      1.15×
                    </option>

                    <option value="1.3">
                      1.30×
                    </option>
                  </select>
                </label>
              </div>

              <div
                className={
                  styles.voiceToggles
                }
              >
                <label>
                  <input
                    type="checkbox"
                    checked={
                      voiceAutoSpeak
                    }
                    onChange={(
                      event,
                    ) =>
                      setVoiceAutoSpeak(
                        event
                          .target
                          .checked,
                      )
                    }
                  />{" "}
                  {t(
                    "قراءة الرد تلقائيًا",
                    "Speak replies automatically",
                  )}
                </label>

                <label>
                  <input
                    type="checkbox"
                    checked={
                      handsFree
                    }
                    onChange={(
                      event,
                    ) =>
                      setHandsFree(
                        event
                          .target
                          .checked,
                      )
                    }
                  />{" "}
                  {t(
                    "وضع التحدث المستمر",
                    "Hands-free conversation",
                  )}
                </label>
              </div>

              <div
                className={
                  styles.voiceTranscript
                }
              >
                {prompt ||
                  t(
                    "اضغط الميكروفون وابدأ الكلام...",
                    "Press the microphone and start speaking...",
                  )}
              </div>

              <button
                className={
                  styles.voiceSend
                }
                onClick={() =>
                  void send()
                }
                disabled={
                  !prompt.trim() ||
                  busy
                }
              >
                {busy
                  ? t(
                      "جاري الرد...",
                      "Replying...",
                    )
                  : t(
                      "إرسال",
                      "Send",
                    )}
              </button>
            </div>
          ) : (
            <div
              className={
                styles.chatBody
              }
            >
              <div
                className={
                  styles.messages
                }
              >
                {!messages.length && (
                  <div
                    className={
                      styles.welcome
                    }
                  >
                    <div
                      className={
                        styles.orbSmall
                      }
                    >
                      ✦
                    </div>

                    <h2>
                      {t(
                        "مرحبًا بك في GameVortex AI",
                        "Welcome to GameVortex AI",
                      )}
                    </h2>

                    <p>
                      {t(
                        "اسأل عن الألعاب أو التطبيقات أو المتجر أو VIP أو أي ميزة داخل GameVortex. المساعد يستخدم بيانات الموقع عند الإجابة عن GameVortex.",
                        "Ask about games, apps, marketplace, VIP or other GameVortex features. The assistant uses site data for GameVortex questions.",
                      )}
                    </p>
                  </div>
                )}

                {messages.map(
                  (
                    message,
                    index,
                  ) => (
                    <article
                      key={
                        message.id ||
                        `${message.role}-${index}`
                      }
                      className={`${styles.message} ${
                        message.role ===
                        "user"
                          ? styles.userMessage
                          : styles.aiMessage
                      }`}
                    >
                      <strong>
                        {message.role ===
                        "user"
                          ? t(
                              "أنت",
                              "You",
                            )
                          : "GameVortex AI"}
                      </strong>

                      <div
                        className={
                          styles.markdown
                        }
                      >
                        {inlineMarkdown(
                          message.content ||
                            (busy &&
                            index ===
                              messages.length -
                                1
                              ? "…"
                              : ""),
                        )}
                      </div>

                      {message.role ===
                        "assistant" &&
                        message.content &&
                        !busy && (
                          <div
                            className={
                              styles.messageActions
                            }
                          >
                            <button
                              onClick={() =>
                                speakText(
                                  message.content,
                                )
                              }
                            >
                              🔊
                            </button>

                            <button
                              onClick={() =>
                                navigator.clipboard?.writeText(
                                  message.content,
                                )
                              }
                            >
                              ⧉
                            </button>

                            <button
                              onClick={() => {
                                const previous =
                                  [
                                    ...messages.slice(
                                      0,
                                      index,
                                    ),
                                  ]
                                    .reverse()
                                    .find(
                                      (
                                        item,
                                      ) =>
                                        item.role ===
                                        "user",
                                    )
                                    ?.content;

                                if (
                                  previous
                                ) {
                                  void send(
                                    previous,
                                    true,
                                  );
                                }
                              }}
                            >
                              ↻
                            </button>
                          </div>
                        )}
                    </article>
                  ),
                )}

                <div
                  ref={
                    bottom
                  }
                />
              </div>

              <form
                className={
                  styles.composer
                }
                onSubmit={(
                  event,
                ) => {
                  event.preventDefault();

                  void send();
                }}
              >
                <button
                  type="button"
                  className={`${styles.iconButton} ${
                    listening
                      ? styles.iconActive
                      : ""
                  }`}
                  onClick={
                    listening
                      ? stopVoice
                      : startVoice
                  }
                  title={t(
                    "تحدث",
                    "Speak",
                  )}
                >
                  🎙
                </button>

                <textarea
                  value={
                    prompt
                  }
                  onChange={(
                    event,
                  ) =>
                    setPrompt(
                      event
                        .target
                        .value,
                    )
                  }
                  placeholder={t(
                    "اسأل GameVortex AI عن الموقع...",
                    "Ask GameVortex AI about the site...",
                  )}
                  onKeyDown={(
                    event,
                  ) => {
                    if (
                      event.key ===
                        "Enter" &&
                      !event.shiftKey
                    ) {
                      event.preventDefault();

                      void send();
                    }
                  }}
                />

                <button
                  type="submit"
                  className={
                    styles.sendButton
                  }
                  disabled={
                    busy ||
                    !prompt.trim()
                  }
                >
                  {busy
                    ? "…"
                    : "↑"}
                </button>

                {busy && (
                  <button
                    type="button"
                    className={
                      styles.stopButton
                    }
                    onClick={() =>
                      aborter.current?.abort()
                    }
                  >
                    {t(
                      "إيقاف",
                      "Stop",
                    )}
                  </button>
                )}
              </form>
            </div>
          )}
        </div>
      </section>
    </main>
  );
                          }
