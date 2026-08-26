import { NextRequest } from "next/server";

const buckets = new Map<string, { count: number; resetAt: number }>();
let lastCleanup = 0;

export function clientKey(request: Request, scope: string) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const real = request.headers.get("x-real-ip")?.trim();
  return `${scope}:${forwarded || real || "unknown"}`;
}

function cleanupExpired(now: number) {
  if (now - lastCleanup < 60_000) return;
  lastCleanup = now;
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
}

function localRateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now(); cleanupExpired(now);
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: Math.max(0, limit - 1), retryAfter: 0 };
  }
  if (current.count >= limit) return { allowed: false, remaining: 0, retryAfter: Math.ceil((current.resetAt - now) / 1000) };
  current.count += 1;
  return { allowed: true, remaining: Math.max(0, limit - current.count), retryAfter: 0 };
}

export function rateLimit(key: string, limit = 60, windowMs = 60_000) {
  // Distributed mode is deliberately opt-in. It is asynchronous and therefore
  // exposed through rateLimitAsync for production deployments. Synchronous
  // callers retain a safe process-local fallback.
  return localRateLimit(key, limit, windowMs);
}

export async function rateLimitAsync(key: string, limit = 60, windowMs = 60_000) {
  if (process.env.RATE_LIMIT_STORE !== "upstash") return localRateLimit(key, limit, windowMs);
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return localRateLimit(key, limit, windowMs);
  try {
    const response = await fetch(`${url}/pipeline`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify([["INCR", key], ["PTTL", key], ["PEXPIRE", key, windowMs]])
    });
    if (!response.ok) throw new Error("UPSTASH_RATE_LIMIT_FAILED");
    const data = await response.json() as Array<{ result: number }>;
    const count = Number(data?.[0]?.result ?? 1);
    let ttl = Number(data?.[1]?.result ?? windowMs);
    if (ttl < 0) ttl = windowMs;
    return { allowed: count <= limit, remaining: Math.max(0, limit - count), retryAfter: Math.ceil(ttl / 1000) };
  } catch {
    return localRateLimit(key, limit, windowMs);
  }
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin) {
    const configured = process.env.APP_ORIGIN?.replace(/\/$/, "");
    if (configured && origin !== configured) return false;
  }
  return request.headers.get("sec-fetch-site") !== "cross-site";
}

export function securityHeaders(extra?: HeadersInit) {
  return new Headers({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "strict-origin-when-cross-origin", "Permissions-Policy": "camera=(), microphone=(), geolocation=()", ...extra });
}
