import { Prisma } from "@prisma/client";
import { db } from "./prisma";

export function logEvent(event: string, data: Record<string, unknown> = {}) {
  const payload = { ts: new Date().toISOString(), event, ...data };
  if (process.env.NODE_ENV !== "test") console.log(JSON.stringify(payload));
}

export function safeError(error: unknown) {
  return error instanceof Error ? error.message : "UNKNOWN_ERROR";
}

/**
 * Best-effort persisted error log (item 33 — Monitoring / Error Handling).
 *
 * This must never throw and must never block or fail the caller's request:
 * it is diagnostic-only. If the database write itself fails (e.g. the
 * outage that caused the original error also took down the DB), we fall
 * back to a console line so the failure is still visible in platform logs.
 *
 * `metadata` is stored as-is in a JSONB column — never pass secrets,
 * passwords, full request bodies, or API keys into it.
 */
export async function logSystemError(
  scope: string,
  error: unknown,
  options: { statusCode?: number; userId?: string | null; metadata?: Record<string, unknown> } = {}
) {
  const message = safeError(error).slice(0, 2000);
  logEvent("system_error", { scope, message, statusCode: options.statusCode });
  try {
    await db.systemError.create({
      data: {
        scope: scope.slice(0, 120),
        message,
        statusCode: options.statusCode ?? null,
        userId: options.userId ?? null,
        // sanitizeMetadata() builds a plain, JSON-safe object at runtime
        // (only strings/numbers/booleans/null/nested objects survive it),
        // but its TypeScript return type is Record<string, unknown> since
        // the input itself is untyped. Prisma's generated Json field type
        // (Prisma.InputJsonValue) doesn't accept `unknown` values even
        // though the actual data is always JSON-compatible, so this cast
        // is safe and required for `tsc --noEmit` / the Vercel build to pass.
        metadata: options.metadata
          ? (sanitizeMetadata(options.metadata) as Prisma.InputJsonValue)
          : undefined,
      },
    });
  } catch (persistError) {
    // Never let the logger itself break the request path. If this happens
    // repeatedly, it means the DB is unreachable — a state the health
    // check endpoint (/api/health) will also surface.
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      event: "system_error_log_failed",
      scope,
      originalMessage: message,
      loggerError: safeError(persistError),
    }));
  }
}

// Strip anything that looks like a secret/credential before it reaches the
// database, in case a caller passes a raw object without thinking about it.
const SENSITIVE_KEY_PATTERN = /pass|secret|token|key|authorization|cookie|card|cvv|ssn/i;

function sanitizeMetadata(input: Record<string, unknown>, depth = 0): Record<string, unknown> {
  if (depth > 3) return {};
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      output[key] = "[REDACTED]";
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      output[key] = sanitizeMetadata(value as Record<string, unknown>, depth + 1);
    } else if (typeof value === "string") {
      output[key] = value.slice(0, 500);
    } else {
      output[key] = value;
    }
  }
  return output;
}
