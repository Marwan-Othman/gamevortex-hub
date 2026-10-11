/**
 * Small helpers shared by the admin client components so every form and
 * button reports failures the same way (Arabic, readable) instead of showing
 * raw API codes such as ONLY_CONFIGURED_OWNER_CAN_BE_SUPER_ADMIN, or silently
 * doing nothing when the request fails.
 */

const MESSAGES: Record<string, string> = {
  UNAUTHORIZED: "انتهت الجلسة. سجّل الدخول من جديد ثم أعد المحاولة.",
  Unauthorized: "انتهت الجلسة. سجّل الدخول من جديد ثم أعد المحاولة.",
  FORBIDDEN: "لا تملك صلاحية تنفيذ هذا الإجراء.",
  Forbidden: "لا تملك صلاحية تنفيذ هذا الإجراء.",
  CSRF_ORIGIN_REJECTED: "رُفض الطلب لأسباب أمنية. أعد تحميل الصفحة ثم حاول مرة أخرى.",
  RATE_LIMITED: "محاولات كثيرة خلال وقت قصير. انتظر قليلًا ثم أعد المحاولة.",
  INVALID_BODY: "البيانات المرسلة غير صالحة.",
  USER_NOT_FOUND: "المستخدم غير موجود.",
  OWNER_ROLE_CANNOT_BE_REMOVED: "لا يمكن إزالة صلاحية المالك عن حسابك.",
  ONLY_CONFIGURED_OWNER_CAN_BE_SUPER_ADMIN:
    "دور SUPER_ADMIN مخصص لحساب المالك المحدد في الإعدادات فقط.",
  SUPER_ADMIN_ALREADY_EXISTS: "يوجد حساب SUPER_ADMIN آخر بالفعل.",
  OWNER_EMAIL_NOT_CONFIGURED: "المتغير OWNER_EMAIL غير مضبوط على الخادم.",
  ALREADY_REVIEWED: "تمت مراجعة هذا العنصر مسبقًا.",
  WALLPAPER_NOT_FOUND: "الخلفية غير موجودة (ربما حُذفت).",
  RECITER_NOT_FOUND: "القارئ غير موجود (ربما حُذف).",
  ACTIVE_REQUIRES_VERIFIED_SOURCE: "لا يمكن تفعيل القارئ قبل التحقق من المصدر.",
  MODERATION_FAILED: "تعذر تنفيذ إجراء المراجعة.",
  INVALID_DRAW_INPUT: "بيانات السحب غير صالحة. راجع الحقول وحاول مجددًا.",
  DRAW_NOT_FOUND: "السحب غير موجود (ربما حُذف).",
  DRAW_ALREADY_DRAWN: "تم سحب الفائز في هذا السحب مسبقًا.",
  DRAW_CANCELLED: "هذا السحب ملغى ولا يمكن تغييره.",
  DRAW_HAS_NO_ENTRIES: "لا يوجد مشاركون في هذا السحب.",
};

export function adminErrorMessage(
  code: unknown,
  fallback = "تعذر تنفيذ العملية. حاول مرة أخرى.",
): string {
  if (typeof code === "string" && MESSAGES[code]) return MESSAGES[code];
  return fallback;
}

/**
 * Turns a failed fetch Response into a readable Arabic message. Never throws,
 * even when the server answered with HTML (a crash page) instead of JSON.
 */
export async function readAdminError(
  response: Response,
  fallback?: string,
): Promise<string> {
  let code: unknown;

  try {
    const data = await response.json();
    code = data?.error;
  } catch {
    // Not JSON — fall through to the status based message.
  }

  if (typeof code === "string" && MESSAGES[code]) return MESSAGES[code];
  if (response.status === 401) return MESSAGES.UNAUTHORIZED;
  if (response.status === 403) return MESSAGES.FORBIDDEN;
  if (response.status === 429) return MESSAGES.RATE_LIMITED;

  return adminErrorMessage(undefined, fallback);
}

/** Network failure (offline, DNS, aborted) — distinct from an API error. */
export const NETWORK_ERROR_MESSAGE =
  "تعذر الاتصال بالخادم. تحقق من الإنترنت ثم أعد المحاولة.";
