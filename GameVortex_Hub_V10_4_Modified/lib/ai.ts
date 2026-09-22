export type AiMessage = {
  role:
    | "system"
    | "user"
    | "assistant";
  content: string;
};

const MAX_INPUT_LENGTH = 4000;
const MAX_SYSTEM_LENGTH = 4000;
const DEFAULT_MAX_OUTPUT = 800;

function cleanText(
  value: string,
  maxLength = MAX_INPUT_LENGTH,
): string {
  return value
    .replace(
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,
      "",
    )
    .trim()
    .slice(0, maxLength);
}

function getMaxOutputTokens(): number {
  const value =
    Number(
      process.env.AI_MAX_OUTPUT_TOKENS ||
        DEFAULT_MAX_OUTPUT,
    );

  if (
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > 4000
  ) {
    return DEFAULT_MAX_OUTPUT;
  }

  return value;
}

export async function aiChat(
  messages: AiMessage[],
) {
  const base =
    process.env.AI_PROVIDER_BASE_URL;

  const key =
    process.env.AI_PROVIDER_API_KEY;

  if (!base || !key) {
    throw new Error(
      "AI_PROVIDER_NOT_CONFIGURED",
    );
  }

  let providerUrl: URL;

  try {
    providerUrl =
      new URL(
        `${base.replace(/\/$/, "")}/chat/completions`,
      );
  } catch {
    throw new Error(
      "AI_PROVIDER_URL_INVALID",
    );
  }

  if (
    providerUrl.protocol !==
      "https:" &&
    process.env.NODE_ENV ===
      "production"
  ) {
    throw new Error(
      "AI_PROVIDER_URL_INVALID",
    );
  }

  const safeMessages =
    messages
      .filter(
        (message) =>
          message &&
          (
            message.role ===
              "system" ||
            message.role ===
              "user" ||
            message.role ===
              "assistant"
          ) &&
          typeof message.content ===
            "string",
      )
      .map(
        (message, index) => ({
          role:
            message.role,
          content:
            index === 0 &&
            message.role ===
              "system"
              ? cleanText(
                  message.content,
                  MAX_SYSTEM_LENGTH,
                )
              : cleanText(
                  message.content,
                  MAX_INPUT_LENGTH,
                ),
        }),
      )
      .filter(
        (message) =>
          message.content.length > 0,
      );

  if (
    safeMessages.length === 0
  ) {
    throw new Error(
      "AI_EMPTY_INPUT",
    );
  }

  const response =
    await fetch(
      providerUrl,
      {
        method: "POST",
        headers: {
          Authorization:
            `Bearer ${key}`,
          "Content-Type":
            "application/json",
          Accept:
            "application/json",
        },
        body: JSON.stringify({
          model:
            process.env.AI_MODEL ||
            "default",
          messages:
            safeMessages,
          temperature: 0.2,
          max_tokens:
            getMaxOutputTokens(),
        }),
        cache: "no-store",
      },
    );

  let data: unknown;

  try {
    data =
      await response.json();
  } catch {
    throw new Error(
      "AI_PROVIDER_INVALID_RESPONSE",
    );
  }

  if (!response.ok) {
    const object =
      data &&
      typeof data ===
        "object"
        ? data as Record<
            string,
            unknown
          >
        : {};

    const error =
      object.error &&
      typeof object.error ===
        "object"
        ? object.error as Record<
            string,
            unknown
          >
        : null;

    throw new Error(
      String(
        error?.message ||
          object.message ||
          "AI_PROVIDER_ERROR",
      ).slice(0, 500),
    );
  }

  const object =
    data &&
    typeof data ===
      "object"
      ? data as Record<
          string,
          unknown
        >
      : {};

  const choices =
    Array.isArray(
      object.choices,
    )
      ? object.choices
      : [];

  const first =
    choices[0];

  const message =
    first &&
    typeof first ===
      "object"
      ? (
          first as Record<
            string,
            unknown
          >
        ).message
      : null;

  const content =
    message &&
    typeof message ===
      "object"
      ? (
          message as Record<
            string,
            unknown
          >
        ).content
      : null;

  if (
    typeof content !==
    "string"
  ) {
    throw new Error(
      "AI_EMPTY_RESPONSE",
    );
  }

  return content
    .trim()
    .slice(0, 20_000);
}
