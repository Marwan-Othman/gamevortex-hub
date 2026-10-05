export type RuntimeConfig = {
  provider: "manus";
  model: "manus";
};

/**
 * Server-only Manus configuration.
 *
 * MANUS_API_KEY is intentionally validated here but never returned to the client.
 * The actual key is consumed only by ManusApiClient on the server.
 */
export function getRuntimeConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): RuntimeConfig {
  const apiKey = env.MANUS_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("MANUS_NOT_CONFIGURED");
  }

  if (apiKey.length < 20 || /[\r\n]/.test(apiKey)) {
    throw new Error("MANUS_CONFIGURATION_INVALID");
  }

  return {
    provider: "manus",
    model: "manus",
  };
}
