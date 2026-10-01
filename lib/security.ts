import { NextRequest } from "next/server";

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

let lastCleanup = 0;

const MAX_LOCAL_BUCKETS = 10_000;

/* =========================================================
 * RATE LIMITING
 * ======================================================= */

export function clientKey(
  request: Request,
  scope: string,
) {
  const forwarded =
    request.headers
      .get("x-forwarded-for")
      ?.split(",")[0]
      ?.trim();

  const real =
    request.headers
      .get("x-real-ip")
      ?.trim();

  const ip =
    forwarded ||
    real ||
    "unknown";

  return `${scope}:${ip}`;
}

function cleanupExpired(
  now: number,
) {
  if (
    now - lastCleanup <
    60_000
  ) {
    return;
  }

  lastCleanup = now;

  for (
    const [key, bucket] of buckets
  ) {
    if (
      bucket.resetAt <= now
    ) {
      buckets.delete(key);
    }
  }

  if (
    buckets.size >
    MAX_LOCAL_BUCKETS
  ) {
    const entries = [
      ...buckets.entries(),
    ].sort(
      (a, b) =>
        a[1].resetAt -
        b[1].resetAt,
    );

    const removeCount =
      buckets.size -
      MAX_LOCAL_BUCKETS;

    for (
      let index = 0;
      index < removeCount;
      index++
    ) {
      buckets.delete(
        entries[index][0],
      );
    }
  }
}

function localRateLimit(
  key: string,
  limit: number,
  windowMs: number,
) {
  const now = Date.now();

  cleanupExpired(now);

  if (
    !Number.isSafeInteger(limit) ||
    limit <= 0
  ) {
    return {
      allowed: false,
      remaining: 0,
      retryAfter:
        Math.ceil(
          windowMs / 1000,
        ),
    };
  }

  if (
    !Number.isSafeInteger(
      windowMs,
    ) ||
    windowMs <= 0
  ) {
    return {
      allowed: false,
      remaining: 0,
      retryAfter: 60,
    };
  }

  const current =
    buckets.get(key);

  if (
    !current ||
    current.resetAt <= now
  ) {
    buckets.set(key, {
      count: 1,
      resetAt:
        now + windowMs,
    });

    return {
      allowed: true,
      remaining:
        Math.max(
          0,
          limit - 1,
        ),
      retryAfter: 0,
    };
  }

  if (
    current.count >= limit
  ) {
    return {
      allowed: false,
      remaining: 0,
      retryAfter:
        Math.ceil(
          (current.resetAt -
            now) /
            1000,
        ),
    };
  }

  current.count += 1;

  return {
    allowed: true,
    remaining:
      Math.max(
        0,
        limit -
          current.count,
      ),
    retryAfter: 0,
  };
}

export function rateLimit(
  key: string,
  limit = 60,
  windowMs = 60_000,
) {
  return localRateLimit(
    key,
    limit,
    windowMs,
  );
}

export async function rateLimitAsync(
  key: string,
  limit = 60,
  windowMs = 60_000,
) {
  if (
    process.env.RATE_LIMIT_STORE !==
    "upstash"
  ) {
    return localRateLimit(
      key,
      limit,
      windowMs,
    );
  }

  const url =
    process.env
      .UPSTASH_REDIS_REST_URL;

  const token =
    process.env
      .UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    return localRateLimit(
      key,
      limit,
      windowMs,
    );
  }

  try {
    const response =
      await fetch(
        `${url.replace(
          /\/$/,
          "",
        )}/pipeline`,
        {
          method: "POST",

          headers: {
            Authorization:
              `Bearer ${token}`,

            "Content-Type":
              "application/json",
          },

          body: JSON.stringify([
            ["INCR", key],
            ["PTTL", key],
            [
              "PEXPIRE",
              key,
              windowMs,
            ],
          ]),
        },
      );

    if (!response.ok) {
      throw new Error(
        "UPSTASH_RATE_LIMIT_FAILED",
      );
    }

    const data =
      (await response.json()) as Array<{
        result: number;
      }>;

    const count =
      Number(
        data?.[0]?.result ??
          1,
      );

    let ttl =
      Number(
        data?.[1]?.result ??
          windowMs,
      );

    if (
      !Number.isFinite(ttl) ||
      ttl < 0
    ) {
      ttl = windowMs;
    }

    return {
      allowed:
        count <= limit,

      remaining:
        Math.max(
          0,
          limit - count,
        ),

      retryAfter:
        Math.ceil(
          ttl / 1000,
        ),
    };
  } catch {
    return localRateLimit(
      key,
      limit,
      windowMs,
    );
  }
}

/* =========================================================
 * ORIGIN SECURITY
 * ======================================================= */

/**
 * Normalizes an origin so comparisons are consistent.
 *
 * Examples:
 *   https://example.com/
 *   https://example.com
 *
 * become:
 *   https://example.com
 */
function normalizeOrigin(
  value: string,
): string | null {
  const trimmed =
    value.trim();

  if (!trimmed) {
    return null;
  }

  try {
    const url =
      new URL(trimmed);

    if (
      url.protocol !==
        "http:" &&
      url.protocol !==
        "https:"
    ) {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Returns the explicitly trusted origins.
 *
 * We do NOT allow every *.vercel.app origin.
 *
 * Instead we allow only:
 *
 * 1. APP_ORIGIN
 * 2. Vercel's current deployment URL
 * 3. Vercel's configured production URL
 * 4. NEXT_PUBLIC_APP_URL, when explicitly configured
 */
function getAllowedOrigins(): Set<string> {
  const origins =
    new Set<string>();

  const configuredValues = [
    process.env.APP_ORIGIN,

    process.env
      .NEXT_PUBLIC_APP_URL,

    process.env
      .VERCEL_PROJECT_PRODUCTION_URL,

    process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : undefined,
  ];

  for (
    const value of configuredValues
  ) {
    if (!value) {
      continue;
    }

    const normalized =
      normalizeOrigin(value);

    if (normalized) {
      origins.add(
        normalized,
      );
    }
  }

  return origins;
}

/**
 * Checks whether the request was sent from
 * one of GameVortex Hub's trusted origins.
 *
 * This intentionally does NOT accept arbitrary
 * Vercel preview domains.
 */
export function sameOrigin(
  request: Request,
) {
  const origin =
    request.headers.get(
      "origin",
    );

  /*
   * If the browser supplies an Origin header,
   * validate it against the explicitly trusted
   * GameVortex origins.
   */
  if (origin) {
    const normalizedOrigin =
      normalizeOrigin(
        origin,
      );

    if (!normalizedOrigin) {
      return false;
    }

    const allowedOrigins =
      getAllowedOrigins();

    /*
     * If we have configured origins, require
     * the browser origin to match one of them.
     */
    if (
      allowedOrigins.size > 0
    ) {
      if (
        !allowedOrigins.has(
          normalizedOrigin,
        )
      ) {
        return false;
      }
    } else {
      /*
       * No explicit origin configuration exists.
       *
       * As a secure fallback, compare the request
       * origin with the actual request URL origin.
       *
       * This avoids trusting arbitrary external origins.
       */
      let requestOrigin: string;

      try {
        requestOrigin =
          new URL(
            request.url,
          ).origin;
      } catch {
        return false;
      }

      if (
        normalizedOrigin !==
        requestOrigin
      ) {
        return false;
      }
    }
  }

  /*
   * Fetch Metadata protection.
   *
   * A browser explicitly identifying the request
   * as cross-site is rejected.
   */
  const fetchSite =
    request.headers.get(
      "sec-fetch-site",
    );

  if (
    fetchSite ===
    "cross-site"
  ) {
    return false;
  }

  return true;
}

/* =========================================================
 * SECURITY HEADERS
 * ======================================================= */

export function securityHeaders(
  extra?: HeadersInit,
) {
  return new Headers({
    "Cache-Control":
      "no-store",

    "X-Content-Type-Options":
      "nosniff",

    "X-Frame-Options":
      "DENY",

    "Referrer-Policy":
      "strict-origin-when-cross-origin",

    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=()",

    ...extra,
  });
}
