/**
 * Central AI model configuration.
 *
 * This is the ONLY place the OpenAI model name is ever set.
 * Every other file must import `openaiConfig` from here — never
 * hardcode a model string (e.g. "gpt-6-astra") anywhere else.
 *
 * To change the model:
 *   - permanently: edit OPENAI_MODEL_DEFAULT below, or
 *   - without a code change: set the OPENAI_MODEL env var.
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
 * OpenAI's current flagship model for hard end-to-end work
 * (reasoning, coding, computer use, research, document creation).
 */
const OPENAI_MODEL_DEFAULT = "gpt-6-astra";

const OPENAI_TIMEOUT_MS_DEFAULT = 60_000;
const OPENAI_MAX_OUTPUT_TOKENS_DEFAULT = 2_000;
const OPENAI_REASONING_EFFORT_DEFAULT: ReasoningEffort = "medium";

function readReasoningEffort(): ReasoningEffort {
  const value = process.env.OPENAI_REASONING_EFFORT;

  return (REASONING_EFFORTS as string[]).includes(String(value))
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
  /** Single source of truth for the model name used everywhere. */
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
