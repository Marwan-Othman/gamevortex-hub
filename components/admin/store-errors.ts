/** Arabic messages for the store admin API error codes (the API returns codes, never text). */
const STORE_ERRORS: Record<string, string> = {
  GAME_NOT_FOUND: "اللعبة غير موجودة.",
  SKU_ALREADY_EXISTS: "رمز SKU مستخدم لمنتج آخر.",
  INVALID_PRODUCT: "بيانات المنتج غير صالحة (راجع السعر والعملة والرابط).",
  INVALID_PRODUCT_UPDATE: "بيانات التعديل غير صالحة (راجع السعر والعملة والرابط).",
  PRODUCT_NOT_FOUND: "المنتج غير موجود.",
  PRODUCT_TYPE_NOT_SUPPORTED_FOR_MARKETPLACE: "المتجر يبيع حاليًا مفاتيح الألعاب (GAME_KEY + كود رقمي) فقط.",
  ACTIVE_PRODUCT_TYPE_NOT_SUPPORTED: "لا يمكن نشر هذا النوع في المتجر حاليًا.",
  GAME_NOT_PUBLISHED: "اللعبة المرتبطة غير منشورة. انشرها أولًا.",
  GAME_SOURCE_NOT_VERIFIED: "مصدر اللعبة غير موثق (VERIFIED أو OFFICIAL_SOURCE).",
  PRODUCT_HAS_NO_DIGITAL_KEYS: "لا توجد مفاتيح متاحة. أضف مفاتيح قبل النشر.",
  SUPPLIER_MUST_BE_VERIFIED_BEFORE_ACTIVATION: "يجب توثيق المورد قبل التفعيل.",
  PRODUCT_HAS_ORDERS: "لا يمكن حذف منتج له طلبات. أخفِه بدل الحذف.",
  PRODUCT_HAS_DIGITAL_KEYS: "لا يمكن حذف منتج سُلّمت أو أُلغيت مفاتيحه. أخفِه بدل الحذف.",
  SUPPLIER_NOT_VERIFIED: "المورد غير موثق.",
  PRODUCT_DOES_NOT_USE_DIGITAL_KEYS: "هذا المنتج لا يستخدم مفاتيح رقمية.",
  DIGITAL_KEY_ENCRYPTION_SECRET_NOT_CONFIGURED: "مفتاح تشفير المفاتيح غير مضبوط على الخادم.",
  INVALID_KEY_IMPORT: "قائمة المفاتيح غير صالحة.",
  DIGITAL_KEY_IMPORT_FAILED: "تعذر استيراد المفاتيح.",
  PRODUCT_CREATE_FAILED: "تعذر إنشاء المنتج.",
  PRODUCT_UPDATE_FAILED: "تعذر تحديث المنتج.",
  PRODUCT_DELETE_FAILED: "تعذر حذف المنتج.",
  FORBIDDEN: "هذه العملية للمالك فقط.",
};

export function storeErrorText(code: unknown, fallback: string): string {
  return typeof code === "string" && STORE_ERRORS[code] ? STORE_ERRORS[code] : fallback;
}
