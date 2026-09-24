export type ReasoningEffort =
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export type GameVortexAiProvider =
  | "GAMEVORTEX"
  | "OPENAI";

const REASONING_EFFORTS: ReasoningEffort[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/* =========================================================
 * GAMEVORTEX AI ENGINE
 * ======================================================= */

/**
 * GameVortex AI is the primary provider architecture.
 *
 * The actual model server is intentionally separated from
 * the Next.js application.
 *
 * This allows GameVortex to run open-source models on its
 * own GPU infrastructure instead of depending permanently
 * on OpenAI/fal.ai/MiniMax.
 *
 * IMPORTANT:
 * The API key is server-side only.
 * NEVER use NEXT_PUBLIC_ for these variables.
 */
const GAMEVORTEX_AI_BASE_URL_DEFAULT = "";

const GAMEVORTEX_CHAT_MODEL_DEFAULT =
  "gamevortex-chat";

const GAMEVORTEX_AI_TIMEOUT_MS_DEFAULT =
  120_000;

/**
 * Primary provider.
 *
 * Keep OPENAI during the migration until the GameVortex
 * self-hosted AI server is connected and tested.
 *
 * Supported values:
 *   GAMEVORTEX
 *   OPENAI
 */
function readProvider(): GameVortexAiProvider {
  const value =
    process.env.GAMEVORTEX_AI_PROVIDER
      ?.trim()
      .toUpperCase();

  if (value === "GAMEVORTEX") {
    return "GAMEVORTEX";
  }

  return "OPENAI";
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

function readReasoningEffort(): ReasoningEffort {
  const value =
    process.env.GAMEVORTEX_AI_REASONING_EFFORT ??
    process.env.OPENAI_REASONING_EFFORT;

  return (
    REASONING_EFFORTS as string[]
  ).includes(String(value))
    ? (value as ReasoningEffort)
    : "medium";
}

/* =========================================================
 * CENTRAL GAMEVORTEX AI CONFIG
 * ======================================================= */

export const gameVortexAiConfig = {
  /**
   * Which AI engine should receive chat requests.
   *
   * During migration this remains OPENAI unless the
   * environment explicitly enables GAMEVORTEX.
   */
  provider: readProvider(),

  /**
   * Self-hosted GameVortex AI server.
   *
   * Example:
   *
   * https://ai.your-domain.com/v1
   *
   * This value must point to infrastructure that actually
   * runs the selected open-source model.
   */
  baseUrl:
    process.env.GAMEVORTEX_AI_BASE_URL
      ?.trim()
      .replace(/\/+$/, "") ||
    GAMEVORTEX_AI_BASE_URL_DEFAULT,

  /**
   * Server-side authentication for the GameVortex AI engine.
   *
   * This is optional because the model server may instead
   * use private networking or another authentication layer.
   */
  apiKey:
    process.env.GAMEVORTEX_AI_API_KEY
      ?.trim() || "",

  /**
   * Chat model running on GameVortex infrastructure.
   */
  chatModel:
    process.env.GAMEVORTEX_CHAT_MODEL
      ?.trim() ||
    GAMEVORTEX_CHAT_MODEL_DEFAULT,

  /**
   * Maximum time allowed for one AI request.
   */
  timeoutMs: readPositiveInt(
    process.env.GAMEVORTEX_AI_TIMEOUT_MS,
    GAMEVORTEX_AI_TIMEOUT_MS_DEFAULT,
    600_000,
  ),

  reasoningEffort:
    readReasoningEffort(),

  maxOutputTokens: readPositiveInt(
    process.env.GAMEVORTEX_AI_MAX_OUTPUT_TOKENS ??
      process.env.OPENAI_MAX_OUTPUT_TOKENS,
    2_000,
    32_000,
  ),
} as const;

/* =========================================================
 * OPENAI FALLBACK CONFIG
 * ======================================================= */

/**
 * OpenAI remains available as a temporary fallback during
 * the migration to GameVortex-owned AI infrastructure.
 *
 * Once the self-hosted GameVortex engine has been fully
 * tested, this fallback can be removed.
 */
export const openaiConfig = {
  model:
    process.env.OPENAI_MODEL?.trim() ||
    "gpt-5.6-luna",

  reasoningEffort:
    readReasoningEffort(),

  maxOutputTokens:
    readPositiveInt(
      process.env.OPENAI_MAX_OUTPUT_TOKENS,
      2_000,
      32_000,
    ),

  timeoutMs:
    readPositiveInt(
      process.env.OPENAI_TIMEOUT_MS,
      60_000,
      300_000,
    ),

  baseUrl:
    "https://api.openai.com/v1",
} as const;

/* =========================================================
 * PROVIDER HELPERS
 * ======================================================= */

/**
 * Returns true when the GameVortex self-hosted engine
 * has been explicitly enabled.
 */
export function isGameVortexAiEnabled(): boolean {
  return (
    gameVortexAiConfig.provider ===
    "GAMEVORTEX"
  );
}

/**
 * Returns true when the temporary OpenAI fallback
 * is active.
 */
export function isOpenAiFallbackEnabled(): boolean {
  return (
    gameVortexAiConfig.provider ===
    "OPENAI"
  );
}

/**
 * Returns the currently selected chat provider.
 */
export function getGameVortexAiProvider(): GameVortexAiProvider {
  return gameVortexAiConfig.provider;
}
