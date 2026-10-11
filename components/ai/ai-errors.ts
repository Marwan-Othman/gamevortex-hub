/**
 * Error codes returned by /api/ai/* (see lib/ai/http.ts) -> Arabic user messages.
 * Shared by the chat and the image/video clients so both stay in sync.
 */
export const AI_ERROR_MESSAGES: Record<string, string> = {
  UNAUTHORIZED: "انتهت الجلسة. سجّل الدخول مرة أخرى.",
  AI_VIP_REQUIRED: "هذه الميزة متاحة لمشتركي VIP فقط.",
  AI_CREDITS_EXHAUSTED: "رصيد GVC غير كافٍ لهذه العملية.",
  INVALID_REQUEST: "الطلب غير صالح. تحقق من النص وحاول مجددًا.",
  INVALID_IMAGE_INPUT: "الصورة المرجعية غير صالحة. استخدم PNG أو JPEG أو WebP.",
  CONVERSATION_NOT_FOUND: "المحادثة غير موجودة. ابدأ محادثة جديدة.",
  AI_REQUEST_IN_PROGRESS: "هذا الطلب قيد التنفيذ بالفعل. انتظر قليلًا.",
  AI_IDEMPOTENCY_KEY_CONFLICT: "تعذّر تنفيذ الطلب بسبب تعارض. أعد المحاولة.",
  AI_EMPTY_RESPONSE: "لم يُرجع الذكاء الاصطناعي نتيجة. لم يُخصم أي رصيد، حاول مجددًا.",
  AI_TIMEOUT: "استغرق الطلب وقتًا أطول من المتوقع. لم يُخصم أي رصيد، حاول مجددًا.",
  AI_SERVICE_UNAVAILABLE: "الخدمة غير متاحة مؤقتًا. لم يُخصم أي رصيد، حاول مجددًا.",
  RATE_LIMITED: "طلبات كثيرة خلال وقت قصير. انتظر لحظات ثم حاول مجددًا.",
  CSRF_ORIGIN_REJECTED: "تعذّر التحقق من الطلب. حدّث الصفحة وحاول مجددًا.",
  CLIENT_TIMEOUT: "انتهت مهلة الانتظار. حدّث الصفحة وتحقق من سجل المحادثة.",
  INVALID_MEDIA_TOKEN: "انتهت صلاحية طلب الفيديو. ابدأ طلبًا جديدًا.",
  VIDEO_GENERATION_FAILED: "فشل إنشاء الفيديو وتمت إعادة أي رصيد خُصم.",
  VIDEO_GENERATION_FAILED_REFUND_PENDING: "فشل إنشاء الفيديو. تعذرت إعادة الرصيد تلقائيًا وتم تسجيل المشكلة للمراجعة.",
  VIDEO_GENERATION_TIMEOUT: "الفيديو ما زال قيد المعالجة. اضغط «متابعة الانتظار» لمتابعة الطلب نفسه دون خصم جديد.",
};

export function aiErrorMessage(code: string | undefined | null) {
  return (code && AI_ERROR_MESSAGES[code]) || AI_ERROR_MESSAGES.AI_SERVICE_UNAVAILABLE;
}

/** Reads `{ error }` from a failed response; falls back to RATE_LIMITED for 429 and a generic code otherwise. */
export async function readApiError(response: Response): Promise<string> {
  const json = await response.json().catch(() => null) as { error?: unknown } | null;
  if (json && typeof json.error === "string") return json.error;
  return response.status === 429 ? "RATE_LIMITED" : "AI_SERVICE_UNAVAILABLE";
}

export type AiUsageSummary = { unlimited: boolean; balance: number | null; isVip: boolean };

export async function loadAiUsage(): Promise<AiUsageSummary | null> {
  try {
    const response = await fetch("/api/ai/usage", { cache: "no-store" });
    if (!response.ok) return null;
    const json = await response.json();
    return {
      unlimited: json?.unlimited === true,
      balance: typeof json?.balance === "number" ? json.balance : null,
      isVip: json?.vip?.isVip === true,
    };
  } catch {
    return null;
  }
}

export function formatBalance(usage: AiUsageSummary | null) {
  if (!usage) return "";
  if (usage.unlimited) return "الرصيد: غير محدود";
  return "رصيد GVC: " + (usage.balance ?? 0);
}
