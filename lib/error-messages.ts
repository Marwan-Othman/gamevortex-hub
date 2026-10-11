/**
 * Client-safe mapping from API error codes / HTTP statuses to messages a person can understand
 * (Phase 18 — Error Handling). The server never sends raw exception text; it sends a short code
 * (`{ error: "RATE_LIMITED" }`) and, for 5xx, a `requestId` that is also in the server log.
 */
const MESSAGES: Record<string, string> = {
  UNAUTHORIZED: "سجّل الدخول للمتابعة.",
  FORBIDDEN: "ليست لديك صلاحية لتنفيذ هذا الإجراء.",
  NOT_FOUND: "العنصر المطلوب غير موجود.",
  RATE_LIMITED: "محاولات كثيرة. انتظر قليلًا ثم أعد المحاولة.",
  INVALID_INPUT: "البيانات المُدخلة غير صحيحة. راجعها وحاول مجددًا.",
  INVALID_BODY: "تعذّر قراءة الطلب. حدّث الصفحة وحاول مجددًا.",
  INVALID_REQUEST: "الطلب غير صالح. راجع البيانات وحاول مجددًا.",
  ALREADY_EXISTS: "هذا العنصر موجود مسبقًا.",
  CSRF_ORIGIN_REJECTED: "تعذّر التحقق من الطلب. حدّث الصفحة وحاول مجددًا.",
  SERVICE_UNAVAILABLE: "الخدمة غير متاحة مؤقتًا. حاول مجددًا بعد قليل.",
  INTERNAL_ERROR: "حدث خطأ في الخادم. تم تسجيله، حاول مجددًا لاحقًا.",
  AUTH_CHECK_FAILED: "تعذّر التحقق من حسابك الآن. حاول مجددًا بعد قليل.",
  GAME_NOT_FOUND: "اللعبة غير موجودة أو لم تعد متاحة.",
  USER_NOT_FOUND: "المستخدم غير موجود.",
  INSUFFICIENT_POINTS: "رصيد النقاط غير كافٍ.",
  INSUFFICIENT_BALANCE: "رصيد المحفظة غير كافٍ.",
  PAYMENT_PROVIDER_NOT_CONFIGURED: "الدفع غير مفعّل بعد. لن يتم تحصيل أي مبلغ.",
  PAYMENT_PROVIDER_ERROR: "تعذّر الاتصال بمزوّد الدفع. لم يتم تحصيل أي مبلغ، حاول لاحقًا.",
};

const STATUS_MESSAGES: Record<number, string> = {
  400: MESSAGES.INVALID_REQUEST,
  401: MESSAGES.UNAUTHORIZED,
  403: MESSAGES.FORBIDDEN,
  404: MESSAGES.NOT_FOUND,
  409: "تعارض مع حالة حالية. حدّث الصفحة وحاول مجددًا.",
  429: MESSAGES.RATE_LIMITED,
  500: MESSAGES.INTERNAL_ERROR,
  502: MESSAGES.SERVICE_UNAVAILABLE,
  503: MESSAGES.SERVICE_UNAVAILABLE,
  504: MESSAGES.SERVICE_UNAVAILABLE,
};

export const NETWORK_ERROR_MESSAGE = "تعذّر الاتصال بالخادم. تحقق من الإنترنت وأعد المحاولة.";

/** Message for an API error code. Unknown codes fall back to `fallback` (never the raw English code). */
export function friendlyError(code: unknown, fallback = "حدث خطأ غير متوقع. حاول مجددًا."): string {
  if (typeof code !== "string" || !code) return fallback;
  if (MESSAGES[code]) return MESSAGES[code];
  // Some routes intentionally return a ready Arabic sentence.
  if (/[\u0600-\u06FF]/.test(code)) return code;
  return fallback;
}

/**
 * Reads a failed fetch Response and returns a user-facing message.
 * Never throws: an HTML/empty error page (proxy 502, Vercel 504) still produces a sensible message.
 */
export async function messageFromResponse(response: Response, fallback?: string): Promise<string> {
  let code: unknown;
  let requestId: unknown;
  try {
    const data = (await response.clone().json()) as { error?: unknown; requestId?: unknown };
    code = data?.error;
    requestId = data?.requestId;
  } catch {
    // body was not JSON
  }
  const base =
    (typeof code === "string" && (MESSAGES[code] || /[\u0600-\u06FF]/.test(code)) ? friendlyError(code) : "") ||
    fallback ||
    STATUS_MESSAGES[response.status] ||
    (response.status >= 500 ? MESSAGES.INTERNAL_ERROR : "تعذّر تنفيذ العملية. حاول مجددًا.");
  return response.status >= 500 && typeof requestId === "string" && requestId
    ? `${base} (رمز المرجع: ${requestId.slice(0, 8)})`
    : base;
}
