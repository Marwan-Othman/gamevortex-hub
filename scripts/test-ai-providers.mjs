/**
 * Safely tests connectivity to the three configured AI providers
 * (OpenAI, fal.ai, MiniMax) WITHOUT ever printing a real key value
 * and WITHOUT writing anything to the app's database/log system.
 *
 * This is a manual, local/CI-only diagnostic tool. It never runs
 * automatically during build or in a request path.
 *
 * Usage:
 *   node --env-file=.env scripts/test-ai-providers.mjs
 *   npm run test:ai-providers
 */

const TIMEOUT_MS = 10_000;

function mask(key) {
  if (!key) return "(not set)";
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}...${key.slice(-4)} (${key.length} chars)`;
}

// Defensive redaction: never let a real key value leak into console
// output, even inside a caught error message.
function redact(text, secrets) {
  let safe = String(text);
  for (const secret of secrets) {
    if (secret && secret.length >= 6) {
      safe = safe.split(secret).join("[REDACTED]");
    }
  }
  return safe;
}

async function timedFetch(url, options, secrets) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return { ok: response.ok, status: response.status };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "UNKNOWN_ERROR";
    return { ok: false, status: null, error: redact(message, secrets) };
  } finally {
    clearTimeout(timer);
  }
}

async function testOpenAI() {
  const key = process.env.OPENAI_API_KEY;

  if (!key) {
    return { name: "OpenAI", skipped: true };
  }

  const result = await timedFetch(
    "https://api.openai.com/v1/models",
    {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
    },
    [key],
  );

  return { name: "OpenAI", masked: mask(key), ...result };
}

async function testFal() {
  const key = process.env.FAL_KEY;

  if (!key) {
    return { name: "fal.ai", skipped: true };
  }

  const result = await timedFetch(
    "https://api.fal.ai/v1/models?limit=1",
    {
      method: "GET",
      headers: { Authorization: `Key ${key}` },
    },
    [key],
  );

  return { name: "fal.ai", masked: mask(key), ...result };
}

async function testMiniMax() {
  const key = process.env.MINIMAX_API_KEY;

  if (!key) {
    return { name: "MiniMax", skipped: true };
  }

  const base =
    process.env.MINIMAX_API_BASE_URL?.replace(/\/$/, "") ||
    "https://api.minimax.io";

  // Balance/quota check — does not trigger any generation job,
  // so it is a safe, cost-free way to confirm the key works.
  const result = await timedFetch(
    `${base}/v1/token_plan/remains`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
    },
    [key],
  );

  return { name: "MiniMax", masked: mask(key), ...result };
}

function printResult(result) {
  if (result.skipped) {
    console.log(`⚠️  ${result.name}: SKIPPED (no key set in env)`);
    return;
  }

  if (result.ok) {
    console.log(
      `✅ ${result.name}: OK — key ${result.masked} connected successfully (HTTP ${result.status})`,
    );
    return;
  }

  if (result.status) {
    const reason =
      result.status === 401 || result.status === 403
        ? "invalid or unauthorized key"
        : `unexpected response`;
    console.log(
      `❌ ${result.name}: FAILED — ${reason} (HTTP ${result.status}) — key ${result.masked}`,
    );
    return;
  }

  console.log(
    `❌ ${result.name}: FAILED — network/connection error: ${result.error} — key ${result.masked}`,
  );
}

async function main() {
  console.log("GameVortex AI — provider connectivity check");
  console.log("(no key values are ever printed)\n");

  const results = await Promise.all([
    testOpenAI(),
    testFal(),
    testMiniMax(),
  ]);

  for (const result of results) {
    printResult(result);
  }

  const anyFailed = results.some(
    (r) => !r.skipped && !r.ok,
  );

  if (anyFailed) {
    process.exit(1);
  }
}

main();
