import {
  openaiRespond,
  type OpenAiMessage,
} from "@/lib/ai/openai";

export type AiMessage = OpenAiMessage;

/**
 * Maximum length accepted by the GameVortex AI chat layer.
 *
 * The API route also validates this with Zod.
 * This second layer protects server-side callers.
 */
const MAX_INPUT_LENGTH = 4000;
const MAX_SYSTEM_LENGTH = 4000;

function cleanText(
  value: string,
  maxLength: number,
): string {
  return value
    .replace(
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,
      "",
    )
    .trim()
    .slice(0, maxLength);
}

function sanitizeMessages(
  messages: AiMessage[],
): AiMessage[] {
  const safeMessages = messages
    .filter(
      (message) =>
        message &&
        (
          message.role === "system" ||
          message.role === "user" ||
          message.role === "assistant"
        ) &&
        typeof message.content === "string",
    )
    .map((message) => ({
      role: message.role,
      content: cleanText(
        message.content,
        message.role === "system"
          ? MAX_SYSTEM_LENGTH
          : MAX_INPUT_LENGTH,
      ),
    }))
    .filter(
      (message) =>
        message.content.length > 0,
    );

  if (safeMessages.length === 0) {
    throw new Error("AI_EMPTY_INPUT");
  }

  return safeMessages;
}

/**
 * Non-streaming GameVortex AI chat.
 *
 * This function keeps the old aiChat() API so existing
 * callers do not need to be rewritten.
 *
 * The actual provider is OpenAI.
 */
export async function aiChat(
  messages: AiMessage[],
): Promise<string> {
  const safeMessages =
    sanitizeMessages(messages);

  const result =
    await openaiRespond(
      safeMessages,
    );

  return result.text
    .trim()
    .slice(0, 20_000);
}
