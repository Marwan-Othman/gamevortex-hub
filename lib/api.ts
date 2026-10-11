import {
  NextRequest,
  NextResponse,
} from "next/server";

import { randomUUID } from "node:crypto";

import { redactSecrets } from "./redact";
import {
  clientKey,
  rateLimitAsync,
  sameOrigin,
} from "./security";

async function guard(
  request: Request,
  scope: string,
  limit: number,
) {
  const result =
    await rateLimitAsync(
      clientKey(
        request,
        scope,
      ),
      limit,
      60_000,
    );

  if (!result.allowed) {
    return NextResponse.json(
      {
        error: "RATE_LIMITED",
        retryAfter:
          result.retryAfter,
      },
      {
        status: 429,
        headers: {
          "Retry-After":
            String(
              result.retryAfter,
            ),
        },
      },
    );
  }

  return null;
}

export async function guardMutation(
  request:
    | NextRequest
    | Request,
  scope: string,
  limit = 30,
) {
  if (!sameOrigin(request)) {
    return NextResponse.json(
      {
        error:
          "CSRF_ORIGIN_REJECTED",
      },
      {
        status: 403,
      },
    );
  }

  return guard(
    request,
    scope,
    limit,
  );
}

export async function guardRead(
  request:
    | NextRequest
    | Request,
  scope: string,
  limit = 120,
) {
  return guard(
    request,
    scope,
    limit,
  );
}

/* =========================================================
 * ERROR HANDLING (Phase 18)
 *
 * Contract for every API route:
 *  - the client always receives JSON `{ error: "<CODE>" }` (+ `requestId` for 5xx) and a truthful HTTP status;
 *  - raw error messages / stacks / SQL / secrets NEVER reach the client;
 *  - the server log line carries everything needed to debug it (scope, error name, Prisma code,
 *    redacted message, shortened redacted stack, requestId).
 * ======================================================= */

const PRISMA_UNAVAILABLE_CODES = new Set(["P1001", "P1002", "P1008", "P1017", "P2024"]);

function prismaCodeOf(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const code = (error as Error & { code?: unknown }).code;
  return typeof code === "string" && /^P\d{4}$/.test(code) ? code : undefined;
}

/** True when the database itself is unreachable / timed out (not a bug in our query). */
export function isDatabaseUnavailable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "PrismaClientInitializationError") return true;
  const code = prismaCodeOf(error);
  return code !== undefined && PRISMA_UNAVAILABLE_CODES.has(code);
}

/**
 * Structured server-side log line for a route failure.
 * Everything is passed through redactSecrets() so connection strings, bearer tokens,
 * API keys and hashes can never end up in Vercel logs.
 */
export function logRouteError(
  scope: string,
  error: unknown,
  extra: Record<string, unknown> = {},
) {
  const err = error instanceof Error ? error : new Error(String(error ?? "UNKNOWN_ERROR"));
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    event: "route_error",
    scope,
    name: err.name,
    prismaCode: prismaCodeOf(err),
    message: err.message.slice(0, 600),
    stack: (err.stack ?? "").split("\n").slice(0, 6).join("\n").slice(0, 1500),
    ...extra,
  });
  console.error(redactSecrets(line));
}

/**
 * 500 / 503 response for an UNEXPECTED failure.
 * Logs the full detail server-side (with a requestId) and returns only a fixed code + requestId.
 * Database outages answer 503 so clients and monitors can tell "retry later" from "bug".
 */
export function internalError(
  scope: string,
  error: unknown,
  code = "INTERNAL_ERROR",
  extra: Record<string, unknown> = {},
) {
  const requestId = randomUUID();
  const unavailable = isDatabaseUnavailable(error);
  logRouteError(scope, error, { requestId, status: unavailable ? 503 : 500, ...extra });
  return NextResponse.json(
    { error: unavailable ? "SERVICE_UNAVAILABLE" : code, requestId },
    {
      status: unavailable ? 503 : 500,
      headers: {
        "Cache-Control": "no-store",
        ...(unavailable ? { "Retry-After": "30" } : {}),
      },
    },
  );
}

/**
 * Domain error codes are SCREAMING_SNAKE_CASE strings thrown on purpose
 * (e.g. "INSUFFICIENT_POINTS"). Anything else - Prisma messages, upstream
 * provider errors, stack hints, config problems - is an unexpected failure and
 * must never be echoed to the client.
 */
const DOMAIN_ERROR_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
// "X_NOT_CONFIGURED" codes (payment provider, origin) are intentional 503 signals; only codes that
// name a secret/credential are withheld.
const INTERNAL_ERROR_CODE = /(SECRET|PRIVATE_KEY)/;

/**
 * Returns the error's message only when it is an intentional domain code;
 * otherwise returns `fallback` and records the masked message server-side.
 */
export function publicErrorCode(error: unknown, fallback: string): string {
  if (error instanceof Error && error.name === "ZodError") return "INVALID_INPUT";
  const message = error instanceof Error ? error.message : "";
  if (DOMAIN_ERROR_CODE.test(message) && !INTERNAL_ERROR_CODE.test(message)) {
    return message;
  }
  if (message) {
    // Keep the original event name (dashboards/alerts may match on it) but add the debugging detail.
    console.error(
      redactSecrets(
        JSON.stringify({
          ts: new Date().toISOString(),
          event: "route_error_masked",
          fallback,
          name: error instanceof Error ? error.name : undefined,
          prismaCode: prismaCodeOf(error),
          message: message.slice(0, 500),
          stack: (error instanceof Error ? error.stack ?? "" : "")
            .split("\n")
            .slice(0, 6)
            .join("\n")
            .slice(0, 1500),
        }),
      ),
    );
  }
  return fallback;
}

/** Maps an intentional domain code to the HTTP status that describes it truthfully. */
export function statusForErrorCode(code: string, fallbackStatus = 400): number {
  if (code === "UNAUTHORIZED") return 401;
  if (code === "FORBIDDEN") return 403;
  if (code === "RATE_LIMITED") return 429;
  if (code === "NOT_FOUND" || /_NOT_FOUND$/.test(code)) return 404;
  if (
    code === "ALREADY_EXISTS" ||
    /(^|_)ALREADY_/.test(code) ||
    /_(CONFLICT|EXISTS|DUPLICATE)$/.test(code) ||
    /^IDEMPOTENCY_KEY_CONFLICT$/.test(code)
  ) {
    return 409;
  }
  if (/_NOT_CONFIGURED$/.test(code) || /_UNAVAILABLE$/.test(code)) return 503;
  return fallbackStatus;
}

/**
 * Error response for signed-in-user routes.
 * - not signed in  -> 401 UNAUTHORIZED (the UI shows "log in" instead of a generic failure)
 * - not allowed    -> 403 FORBIDDEN
 * - malformed JSON / failed validation -> 400
 * - intentional domain code (e.g. INSUFFICIENT_POINTS) -> that code, with a truthful status
 * - DB outage      -> 503 SERVICE_UNAVAILABLE (+ Retry-After)
 * - anything else  -> 500 `fallback` + requestId; the raw message is only written to the server log.
 */
export function userRouteError(error: unknown, fallback: string, scope = "user-route") {
  const message = error instanceof Error ? error.message : "";
  if (message === "UNAUTHORIZED") {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (message === "FORBIDDEN") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  if (error instanceof SyntaxError) {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  if (error instanceof Error && error.name === "ZodError") {
    return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  }
  const prismaCode = prismaCodeOf(error);
  if (prismaCode === "P2025") return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (prismaCode === "P2002") return NextResponse.json({ error: "ALREADY_EXISTS" }, { status: 409 });
  if (
    error instanceof Error &&
    DOMAIN_ERROR_CODE.test(message) &&
    !INTERNAL_ERROR_CODE.test(message)
  ) {
    return NextResponse.json({ error: message }, { status: statusForErrorCode(message, 400) });
  }
  return internalError(scope, error, fallback);
}

/**
 * Error response for owner/admin routes (requireOwner / requireTradingAccess).
 * - not signed in -> 401, wrong role -> 403, malformed JSON -> 400
 * - intentional domain code -> that code with a truthful status
 * - everything else -> `fallback` with `fallbackStatus`, never the raw message.
 */
export function ownerRouteError(
  error: unknown,
  fallback: string,
  fallbackStatus = 400,
) {
  const message = error instanceof Error ? error.message : "";
  if (message === "UNAUTHORIZED") {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (message === "FORBIDDEN") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  if (error instanceof SyntaxError) {
    return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });
  }
  if (error instanceof Error && error.name === "ZodError") {
    return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  }
  const prismaCode = prismaCodeOf(error);
  if (prismaCode === "P2025") {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  if (prismaCode === "P2002") {
    return NextResponse.json({ error: "ALREADY_EXISTS" }, { status: 409 });
  }
  if (isDatabaseUnavailable(error)) {
    return internalError("owner-route", error, fallback);
  }
  const code = publicErrorCode(error, fallback);
  return NextResponse.json(
    { error: code },
    { status: code === fallback ? fallbackStatus : statusForErrorCode(code, fallbackStatus) },
  );
}
