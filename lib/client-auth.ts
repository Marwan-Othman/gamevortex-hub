"use client";

/**
 * Shared, de-duplicated `/api/auth/me` client (Phase 16).
 *
 * SiteHeader used to call `/api/auth/me` (a DB lookup + a rate-limit write) on EVERY route change,
 * and AccountNav called it again on its own. Now:
 *  - concurrent callers share one in-flight request;
 *  - the answer is reused for ME_TTL_MS;
 *  - login / register / logout call `invalidateMe()` so the UI never shows a stale identity.
 */
export type Me = {
  id?: string;
  username?: string | null;
  email?: string | null;
  role?: string | null;
  points?: number;
} | null;

const ME_TTL_MS = 30_000;
export const AUTH_CHANGE_EVENT = "gv-auth-change";

let cached: { value: Me; at: number } | null = null;
let inflight: Promise<Me> | null = null;

export function fetchMe(): Promise<Me> {
  if (cached && Date.now() - cached.at < ME_TTL_MS) return Promise.resolve(cached.value);
  if (inflight) return inflight;

  const request = fetch("/api/auth/me", { cache: "no-store" })
    .then(async (response): Promise<{ value: Me; cacheable: boolean }> => {
      if (response.ok) return { value: (await response.json()) as Me, cacheable: true };
      // 401 = genuinely signed out (safe to cache). 5xx / 429 = the check itself failed:
      // show the signed-out UI for now but do NOT remember it, otherwise a 1-second
      // server hiccup logs a signed-in user out of the header for 30 seconds.
      return { value: null, cacheable: response.status === 401 };
    })
    .catch((): { value: Me; cacheable: boolean } => ({ value: null, cacheable: false }))
    .then(({ value, cacheable }) => {
      if (cacheable) cached = { value, at: Date.now() };
      return value;
    })
    .finally(() => {
      if (inflight === request) inflight = null;
    });

  inflight = request;
  return request;
}

/** Forget the cached identity and tell every mounted consumer to re-read it. */
export function invalidateMe() {
  cached = null;
  inflight = null;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
}
