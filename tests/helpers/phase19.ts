/**
 * Shared helpers for the Phase 19 test suites (not a test file itself).
 *
 * Every request gets its own client IP so the real in-memory rate limiter in
 * lib/security.ts never throttles a test by accident. A test that wants to
 * exercise the limiter passes the same `ip` repeatedly.
 */
import { NextRequest } from "next/server";

let ipCounter = 0;

export function nextIp(): string {
  ipCounter += 1;
  return `10.19.${Math.floor(ipCounter / 250)}.${(ipCounter % 250) + 1}`;
}

type RequestOptions = {
  method?: string;
  /** Object body: serialized as JSON. */
  body?: unknown;
  /** Raw string body, for malformed-JSON cases. Wins over `body`. */
  rawBody?: string;
  headers?: Record<string, string>;
  ip?: string;
};

export function makeRequest(url: string, options: RequestOptions = {}): NextRequest {
  const method = options.method ?? (options.body !== undefined || options.rawBody !== undefined ? "POST" : "GET");
  const headers: Record<string, string> = {
    "x-forwarded-for": options.ip ?? nextIp(),
    ...(options.body !== undefined || options.rawBody !== undefined ? { "content-type": "application/json" } : {}),
    ...options.headers,
  };
  const init: RequestInit = { method, headers };
  if (method !== "GET" && method !== "HEAD") {
    if (options.rawBody !== undefined) init.body = options.rawBody;
    else if (options.body !== undefined) init.body = JSON.stringify(options.body);
  }
  return new NextRequest(`http://localhost${url}`, init);
}

/** Route handlers that take a dynamic segment receive `{ params: Promise<...> }`. */
export function routeParams<T extends Record<string, string>>(params: T) {
  return { params: Promise.resolve(params) };
}

/** A Prisma-style error with a code, the way the real client reports it. */
export function prismaCodeError(code: string, message = "database error") {
  return Object.assign(new Error(message), { code });
}

export function dbDownError() {
  return Object.assign(new Error("Can't reach database server at `db.internal:5432`"), {
    code: "P1001",
    name: "PrismaClientInitializationError",
  });
}

/** Wait for all queued microtasks/timers of the current turn. */
export const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
