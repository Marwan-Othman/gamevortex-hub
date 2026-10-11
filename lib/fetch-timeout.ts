/**
 * fetch() with a hard deadline (Phase 18 — Error Handling).
 *
 * A bare fetch() to Stripe / PayPal / email / exchange APIs has no deadline: if the upstream hangs,
 * the serverless function hangs until the platform kills it and the user sees a blank 504.
 * With a deadline the call fails fast, the caller's catch block runs, and the user gets a
 * clear error instead.
 *
 * - If the caller already passes `signal`, both signals are honoured (whichever fires first wins).
 * - The thrown error is a normal Error (name "TimeoutError" / "AbortError"); it never contains the URL,
 *   so no query-string credentials can leak through the message.
 */
export const DEFAULT_FETCH_TIMEOUT_MS = 15_000;

export async function fetchWithTimeout(
  input: string | URL | Request,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
  return fetch(input, { ...init, signal });
}

/** Parses a JSON body without throwing when the upstream answered with HTML / empty text (e.g. a 502 page). */
export async function readJsonSafe<T = Record<string, unknown>>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    return {} as T;
  }
}
