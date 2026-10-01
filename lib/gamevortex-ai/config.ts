export type RuntimeConfig = {
  model: string;
};

const DEFAULT_MODEL =
  "gemini-3.1-flash-lite";

/**
 * Server-only Gemini configuration.
 *
 * GEMINI_API_KEY is never returned to the client.
 */
export function getRuntimeConfig(
  env: Readonly<
    Record<string, string | undefined>
  > = process.env,
): RuntimeConfig {
  const apiKey =
    env.GEMINI_API_KEY?.trim();

  if (!apiKey) {
    throw new Error(
      "GEMINI_NOT_CONFIGURED",
    );
  }

  if (apiKey.length < 20) {
    throw new Error(
      "GEMINI_CONFIGURATION_INVALID",
    );
  }

  const model =
    (
      env.GEMINI_MODEL ||
      DEFAULT_MODEL
    ).trim();

  if (
    !model ||
    model.length > 128 ||
    /[\u0000-\u0020]/.test(model)
  ) {
    throw new Error(
      "GEMINI_CONFIGURATION_INVALID",
    );
  }

  return {
    model,
  };
}
