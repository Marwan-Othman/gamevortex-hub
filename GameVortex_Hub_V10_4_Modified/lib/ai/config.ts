/**
 * Central AI model configuration.
 *
 * The OpenAI API key is NEVER stored here.
 * It is read only by the server-side OpenAI client.
 */

export type ReasoningEffort =
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

const REASONING_EFFORTS: ReasoningEffort[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/**
 * Default GameVortex AI model.
 *
 * Can be overridden safely with OPENAI_MODEL.
 */
const OPENAI_MODEL_DEFAULT = "gpt-5.6-luna";

const OPENAI_TIMEOUT_MS_DEFAULT = 60_000;
const OPENAI_MAX_OUTPUT_TOKENS_DEFAULT = 2_000;
const OPENAI_REASONING_EFFORT_DEFAULT: ReasoningEffort =
  "medium";

function readReasoningEffort(): ReasoningEffort {
  const value = process.env.OPENAI_REASONING_EFFORT;

  return (REASONING_EFFORTS as string[]).includes(
    String(value),
  )
    ? (value as ReasoningEffort)
    : OPENAI_REASONING_EFFORT_DEFAULT;
}

function readPositiveInt(
  rawValue: string | undefined,
  fallback: number,
  max: number,
): number {
  const value = Number(rawValue);

  if (
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > max
  ) {
    return fallback;
  }

  return value;
}

export const openaiConfig = {
  model:
    process.env.OPENAI_MODEL?.trim() ||
    OPENAI_MODEL_DEFAULT,

  reasoningEffort: readReasoningEffort(),

  maxOutputTokens: readPositiveInt(
    process.env.OPENAI_MAX_OUTPUT_TOKENS,
    OPENAI_MAX_OUTPUT_TOKENS_DEFAULT,
    32_000,
  ),

  timeoutMs: readPositiveInt(
    process.env.OPENAI_TIMEOUT_MS,
    OPENAI_TIMEOUT_MS_DEFAULT,
    300_000,
  ),

  baseUrl: "https://api.openai.com/v1",
} as const;
