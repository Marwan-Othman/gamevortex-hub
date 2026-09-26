const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "ollama"]);

export type RuntimeConfig = {
  chatUrl: string;
  model: string;
  token?: string;
  local: boolean;
};

/** Resolve and validate server-only configuration. Kept pure so deployment setup is testable. */
export function getRuntimeConfig(env: Readonly<Record<string, string | undefined>> = process.env): RuntimeConfig {
  const raw = env.GAMEVORTEX_AI_RUNTIME_URL?.trim();
  if (!raw) throw new Error("RUNTIME_NOT_CONFIGURED");

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("RUNTIME_CONFIGURATION_INVALID");
  }

  const local = LOCAL_HOSTS.has(url.hostname.toLowerCase());
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.search || url.hash) {
    throw new Error("RUNTIME_CONFIGURATION_INVALID");
  }

  const token = env.GAMEVORTEX_AI_RUNTIME_TOKEN?.trim() || undefined;
  if (!local && !token) throw new Error("RUNTIME_TOKEN_NOT_CONFIGURED");
  if (token && (token.length < 64 || /^(.)\1+$/.test(token) || /replace|change.?me|example/i.test(token))) {
    throw new Error("RUNTIME_CONFIGURATION_INVALID");
  }

  const model = (env.GAMEVORTEX_AI_MODEL || "qwen3:1.7b").trim();
  if (!model || model.length > 128 || /[\u0000-\u0020]/.test(model)) throw new Error("RUNTIME_CONFIGURATION_INVALID");

  const base = url.toString().replace(/\/$/, "");
  return { chatUrl: `${base}/api/chat`, model, ...(token ? { token } : {}), local };
}
