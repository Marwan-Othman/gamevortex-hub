/**
 * GameVortex VIP — كتالوج الباقات (المصدر الوحيد للأسعار والمدد).
 *
 * الأسعار بالسنت (أعداد صحيحة) لتفادي أخطاء الكسور العشرية.
 * هذا الملف يعمل على الخادم فقط كمرجع موثوق: المتصفح يرسل رمز الباقة
 * فقط، وأي سعر أو مدة تأتي من هنا وليس من المتصفح.
 */

export type VipPlanCode =
  | "FREE"
  | "VIP_1M"
  | "VIP_3M"
  | "VIP_6M"
  | "VIP_1Y"
  | "OWNER";

export type VipPlanKind = "FREE" | "PAID" | "OWNER";

export type VipPlan = {
  readonly code: VipPlanCode;
  readonly kind: VipPlanKind;
  readonly emoji: string;
  readonly nameAr: string;
  readonly nameEn: string;
  /** السعر بالسنت. 299 = $2.99 */
  readonly priceCents: number;
  readonly currency: "USD";
  /** مدة الباقة بالأشهر التقويمية. null = بدون مدة (Free / Owner). */
  readonly durationMonths: number | null;
  /** هل يمكن شراؤها. Free و Owner لا تُشترى. */
  readonly purchasable: boolean;
  readonly pointsMultiplier: number;
};

export const VIP_PLANS: readonly VipPlan[] = Object.freeze([
  {
    code: "FREE",
    kind: "FREE",
    emoji: "🆓",
    nameAr: "مجاني",
    nameEn: "Free",
    priceCents: 0,
    currency: "USD",
    durationMonths: null,
    purchasable: false,
    pointsMultiplier: 1,
  },
  {
    code: "VIP_1M",
    kind: "PAID",
    emoji: "👑",
    nameAr: "VIP شهر",
    nameEn: "VIP 1 Month",
    priceCents: 299,
    currency: "USD",
    durationMonths: 1,
    purchasable: true,
    pointsMultiplier: 1.25,
  },
  {
    code: "VIP_3M",
    kind: "PAID",
    emoji: "💎",
    nameAr: "VIP 3 أشهر",
    nameEn: "VIP 3 Months",
    priceCents: 749,
    currency: "USD",
    durationMonths: 3,
    purchasable: true,
    pointsMultiplier: 1.5,
  },
  {
    code: "VIP_6M",
    kind: "PAID",
    emoji: "🔥",
    nameAr: "VIP 6 أشهر",
    nameEn: "VIP 6 Months",
    priceCents: 1999,
    currency: "USD",
    durationMonths: 6,
    purchasable: true,
    pointsMultiplier: 1.75,
  },
  {
    code: "VIP_1Y",
    kind: "PAID",
    emoji: "🏆",
    nameAr: "VIP سنة",
    nameEn: "VIP 1 Year",
    priceCents: 4999,
    currency: "USD",
    durationMonths: 12,
    purchasable: true,
    pointsMultiplier: 2,
  },
  {
    code: "OWNER",
    kind: "OWNER",
    emoji: "👑",
    nameAr: "Owner VIP",
    nameEn: "Owner VIP",
    priceCents: 0,
    currency: "USD",
    durationMonths: null,
    purchasable: false,
    pointsMultiplier: 1,
  },
]);

/** جلب باقة برمزها. يرجع null لأي قيمة غير معروفة (بما فيها غير النصوص). */
export function getVipPlan(code: unknown): VipPlan | null {
  if (typeof code !== "string") return null;
  return VIP_PLANS.find((plan) => plan.code === code) ?? null;
}

/** جلب باقة قابلة للشراء فقط. هذه الدالة تُستخدم عند إنشاء طلب VIP. */
export function getPurchasableVipPlan(code: unknown): VipPlan | null {
  const plan = getVipPlan(code);
  return plan && plan.purchasable ? plan : null;
}

export function listPurchasableVipPlans(): VipPlan[] {
  return VIP_PLANS.filter((plan) => plan.purchasable);
}

/**
 * إضافة أشهر تقويمية (UTC) مع تثبيت اليوم عند آخر يوم في الشهر الهدف.
 * مثال: 31 يناير + شهر = 28 فبراير (أو 29 في السنة الكبيسة).
 */
export function addMonthsUtc(start: Date, months: number): Date {
  if (!(start instanceof Date) || Number.isNaN(start.getTime())) {
    throw new Error("INVALID_START_DATE");
  }
  if (!Number.isInteger(months) || months <= 0) {
    throw new Error("INVALID_MONTHS");
  }

  const totalMonths = start.getUTCMonth() + months;
  const targetYear = start.getUTCFullYear() + Math.floor(totalMonths / 12);
  const targetMonth = totalMonths % 12;
  const lastDayOfTargetMonth = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0),
  ).getUTCDate();
  const day = Math.min(start.getUTCDate(), lastDayOfTargetMonth);

  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      day,
      start.getUTCHours(),
      start.getUTCMinutes(),
      start.getUTCSeconds(),
      start.getUTCMilliseconds(),
    ),
  );
}

/** تاريخ انتهاء الباقة. يرجع null للباقات بدون مدة (Free / Owner). */
export function computeVipEndsAt(startsAt: Date, plan: VipPlan): Date | null {
  if (plan.durationMonths === null) return null;
  return addMonthsUtc(startsAt, plan.durationMonths);
}

/** تنسيق السنت كدولار بأعداد صحيحة فقط: 299 → "$2.99" */
export function formatUsdCents(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new Error("INVALID_CENTS");
  }
  const dollars = Math.floor(cents / 100);
  const remainder = String(cents % 100).padStart(2, "0");
  return `$${dollars}.${remainder}`;
}

/** الشكل العام للباقة كما يُرسل للمتصفح (بدون أي حقول داخلية). */
export type PublicVipPlan = {
  code: VipPlanCode;
  kind: VipPlanKind;
  emoji: string;
  nameAr: string;
  nameEn: string;
  priceCents: number;
  priceLabel: string;
  currency: "USD";
  durationMonths: number | null;
  purchasable: boolean;
  pointsMultiplier: number;
};

export function toPublicVipPlan(plan: VipPlan): PublicVipPlan {
  return {
    code: plan.code,
    kind: plan.kind,
    emoji: plan.emoji,
    nameAr: plan.nameAr,
    nameEn: plan.nameEn,
    priceCents: plan.priceCents,
    priceLabel: formatUsdCents(plan.priceCents),
    currency: plan.currency,
    durationMonths: plan.durationMonths,
    purchasable: plan.purchasable,
    pointsMultiplier: plan.pointsMultiplier,
  };
}
