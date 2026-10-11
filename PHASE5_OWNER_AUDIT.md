# المرحلة 5 — نظام المالك (SUPER_ADMIN)

## نطاق الفحص
- حساب المالك وSUPER_ADMIN، ولوحة المالك، ومحفظة USD والنقاط، والدفتر (OwnerLedger)
- كل routes المالك والإدارة في `app/api/admin/*` و`app/api/owner/*`، وكل صفحات `/admin/*`
- صلاحيات التداول (`requireTradingOwner`) ومنتجات المتجر والمفاتيح الرقمية
- كل مسار يحرّك رصيد المالك (الإضافة والخصم والتخصيص للتداول والاسترداد والسحب)

## حساب المالك
- الدور `SUPER_ADMIN` محصور بحساب واحد: `/api/admin/owner-control` يرفض تعيينه لأي بريد غير `OWNER_EMAIL`، ويرفض وجود أكثر من SUPER_ADMIN، ويمنع المالك من إزالة دوره عن نفسه.
- الدور يُقرأ من قاعدة البيانات في كل طلب، فسحب الدور يسري فوراً.
- سكربتات الإعداد موجودة (`seed-production`، `fix-owner-conflict`، `test-owner-role-policy`).

## لوحة المالك والصفحات
- كل صفحات `/admin/*` تتحقق من SUPER_ADMIN على الخادم (`getOwnerOrAccessScreen` أو فحص مباشر). إخفاء الروابط في الواجهة ليس هو الحماية.

## محفظة المالك والنقاط والدفتر
- الرصيد USD في `availableUsd` والنقاط في `availablePoints` و`pendingPoints`.
- الإضافات (إيرادات البيع، تحرير التداول، الإرجاع) تستخدم `increment` ذرياً.
- الخصومات (سحب، تخصيص للتداول، استرداد) تستخدم `updateMany` بشرط `gte` ويُتحقق من `count === 1`.
- التسوية اليدوية (`owner-wallet/reconcile`) تستخدم CAS على الرصيد المتوقع، ومفتاح idempotency، وسجل تدقيق.
- كل حركة لها مفتاح فريد في `OwnerLedger`، فتكرار الحدث لا يضاعف القيد.

## Owner-only APIs (تم فحصها كلها)
| المسار | التحقق على الخادم |
|---|---|
| `/api/owner/withdraw` | `requireOwner` + `OWNER_WITHDRAWAL_ENABLED` |
| `/api/owner/quran/reciters` | `requireOwner` في كل method |
| `/api/admin/owner-control` | SUPER_ADMIN + قيود المالك الواحد |
| `/api/admin/owner-wallet/reconcile` | `requireOwner` |
| `/api/admin/withdrawals/[id]` | `requireOwner` |
| `/api/admin/trading/*` (نحو 30 route) | `requireTradingOwner` (SUPER_ADMIN فقط، ويُسجَّل كل رفض) |
| `/api/admin/content` | `requireContentOwner` |
| `/api/admin/products/*` | `requireOwner` |
| `/api/admin/orders/[id]/wallet-refund` | تحقق إداري قبل أي عمل |
| `/api/admin/wallpapers/cleanup`، `/api/admin/fazercards/test` | SUPER_ADMIN |

لم يُعثر على أي route إداري أو مالي يكتفي بـ `requireUser` أو `getOptionalUser` دون فحص للدور.

## اختبار المستخدم العادي (تتبّع ساكن)
المسار: المستخدم العادي يصل إلى الـ route مباشرة → `getOptionalUser()` يُرجع USER → فحص الدور يرفض بـ `401` (بدون جلسة) أو `403` (جلسة USER). لا يوجد مسار يتجاوز هذه الخطوة بالترتيب، لأن كل فحص يتم قبل أي قراءة أو كتابة. هذا تتبّع من الكود وليس تشغيلاً فعلياً (انظر قسم التحقق أدناه).

## ما تم إصلاحه

### 1. سحب المالك: سباق بين تغييرات الحالة المتزامنة
- كانت الحالة تُقرأ بلا قفل، فطلبان متزامنان (مثلاً `REJECTED` و`PAID`) قد يحركان النقاط المحجوزة مرتين. مفاتيح الدفتر تختلف بين المسارين، فلم تمنع القيد المزدوج.
- الإصلاح: `SELECT ... FOR UPDATE` على صف السحب قبل قراءة الحالة.
- الأخطاء: الأخطاء المعروفة فقط تُعاد للعميل بحالتها، والباقي يُسجَّل ويُعاد `INTERNAL_ERROR` بـ `500`. خطأ التحقق من المدخلات يُعاد كـ `INVALID_INPUT` بدل تفاصيل Zod.

### 2. طلب السحب: عدم تسريب أخطاء قاعدة البيانات
- كانت الأخطاء غير المعروفة تُرجع نصها الداخلي كما هو، وكانت تُعالَج كـ `400`.
- الآن الأخطاء غير المعروفة تُرجع `500 INTERNAL_ERROR`. وتكرار مفتاح الـ idempotency في طلبين متزامنين (P2002) يُرجع `409 IDEMPOTENCY_KEY_IN_PROGRESS` ليعيد العميل المحاولة.

### 3. استرداد الطلبات: رصيد النقاط كان يُقرأ قديماً
- الخصم من `availablePoints` كان يعتمد على قراءة سابقة بلا قفل، فقد ينزل الرصيد إلى قيمة سالبة إذا أُنفق جزء منه بالتوازي.
- الإصلاح: قفل `OwnerWallet` وإعادة القراءة قبل حساب الكمية المستردة، ثم خصم بشرط `availablePoints >= المطلوب` مع التحقق من `count`.

## ملاحظات لم تُغيَّر (تحتاج قرارك)
1. **الـ webhook يختار "المالك" بـ `findFirst({ role: SUPER_ADMIN })`**: آمن ما دام يوجد SUPER_ADMIN واحد (يفرضه `owner-control`)، لكنه يعتمد على هذا الشرط. الأفضل أن يُحدَّد المالك بـ `OWNER_EMAIL` صراحةً إن أردت ضماناً إضافياً.
2. **حقل `User.ownerPoints`** لا يُكتب إليه في الكود الحالي، ويبدو بقايا من نظام قديم. لم أحذفه لأن حذف الأعمدة يحتاج migration ومراجعة.
3. **تعليق `requireOwner` في `lib/auth.ts`** يتعارض مع الكود (كما في المرحلة 4)، ويحتاج تصحيحاً.
4. **`/api/health`** آمن: الإعدادات (مثل `OWNER_EMAIL` ومفاتيح الدفع) تُعرض فقط بعد `requireOwner` عند إرسال `x-admin-health: 1`، والعموم يرى `{status, database}` فقط.

## تحقق يجب تشغيله محلياً
```bash
npm test                              # توجد اختبارات vitest للمسارات الإدارية والتداول
node scripts/test-owner-role-policy.mjs
```
واختبارات يدوية:
- بدون جلسة: `/api/owner/withdraw` و`/api/admin/withdrawals/<id>` و`/api/admin/trading/status` يجب أن تُرجع `401`.
- بجلسة USER: نفس المسارات يجب أن تُرجع `403`، ولا يتغيّر أي سجل في `OwnerLedger` أو `WithdrawalRequest`.
- طلبا سحب متزامنان بحالتين مختلفتين على نفس السحب: واحد فقط ينجح، والآخر `409`.

---

## تحديث V5 (تصليحات خفيفة)
- **اختيار حساب المالك لقيود الإيرادات والنقاط**: كان `findFirst({ role: SUPER_ADMIN })` في 5 مواضع (`payments/webhook` ×3، `wallet-checkout` ×2). صار عبر دالة واحدة جديدة `lib/owner-account.ts` (`findOwnerAccount`): تفضّل SUPER_ADMIN صاحب `OWNER_EMAIL`، وإلا أقدم SUPER_ADMIN. لا يغيّر سلوك الإنتاج الحالي (حساب واحد)، لكنه يزيل الاعتماد على ترتيب الصفوف.
- **`PATCH /api/admin/withdrawals/[id]`**: JSON فاسد يرجع `400 INVALID_INPUT` بدل `500`.
- لا تغيير في الصلاحيات أو التصميم أو الـ Schema.
