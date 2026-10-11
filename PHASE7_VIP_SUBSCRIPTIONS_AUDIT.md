# المرحلة 7 — VIP + Subscriptions + Credits

## نطاق الفحص
`VipPlan`، `VipSubscription`، `VipPurchase`، صفحات VIP، واجهات VIP (`/api/vip/*`، `/api/admin/vip/*`)، الـ webhook والـ capture الخاصين بالدفع، Owner VIP، ونظام رصيد AI (`AiCreditBalance` / `AiCreditLedger`) في Chat وImage وVideo.

## ما كان سليماً أصلاً
- السعر والمدة والمضاعِف تأتي من الخادم فقط؛ المتصفح يرسل رمز الباقة.
- Owner VIP مشتق من `role = SUPER_ADMIN` ولا يمرّ عبر الدفع، ولا يستهلك رصيداً.
- الوصول لا يعتمد على worker: `getVipAccess` يفحص `expiresAt` مع الوقت الحالي.
- التفعيل والتجديد يعملان داخل transaction بمستوى Serializable، ومنح GVC بمفتاح idempotency فريد.
- الرصيد يُخصم بتحديث شرطي ذرّي (من المرحلة 6) فلا ينزل تحت الصفر.
- Chat/Image/Video تتحقق من VIP قبل أي استهلاك، والاسترداد عند فشل المزوّد idempotent.

## المشاكل التي أُصلحت
| # | الملف | المشكلة | الإصلاح |
|---|-------|---------|---------|
| 1 | `api/vip/rewards` | مكافأة بلا `planId` يستطيع أي مستخدم (حتى غير VIP) استلامها **عدداً غير محدود من المرات** بإرسال مفتاح جديد كل مرة = نقاط مجانية | تشترط اشتراكاً نشطاً (الباقة المحددة أو أي باقة)، وحدّ استلام واحد لكل مكافأة لكل اشتراك مع قفل صف الاشتراك، وتسجيل `lastRewardAt`، وأخطاء معقّمة |
| 2 | `api/ai/image` + `lib/ai/credits.ts` | إعادة استخدام نفس `idempotencyKey` تُرجع «محجوز مسبقاً» فيُولَّد الشغل **مجاناً** (حتى بعد استرداد الحجز) | الاستدعاء المكرر يُرفض 409؛ المفتاح لا يُعاد استخدامه بمبلغ/نوع مختلف ولا بعد استرداده (`AI_IDEMPOTENCY_KEY_CONFLICT`) |
| 3 | `lib/ai/gateway.ts` | فشل بالدفع/الاستدعاء كان قد يسترد حجزاً دفعه طلب سابق بنفس المفتاح | الاسترداد فقط للطلب الذي حجز فعلاً (`reservedHere`) |
| 4 | `lib/ai/credits.ts` | فحص VIP خارج transaction الخصم: اشتراك ينتهي/يُسترد بين الفحص والخصم يظل يصرف | فحص الأهلية (Owner أو اشتراك ACTIVE غير منتهٍ) داخل نفس transaction الخصم → `AI_VIP_REQUIRED` |
| 5 | `vip-payment-webhook` (REFUNDED) | استرداد VIP لا يسحب الـ GVC الممنوحة | `revokeVipGvcInTransaction`: يسحب ما تبقى فقط (لا سالب)، مرة واحدة، ويُسجَّل بالدفتر `VIP_GVC_REFUND_REVOKE` |
| 6 | `vip-payment-webhook` (REFUNDED) | استرداد لاشتراك لم يُدفع يقلبه REFUNDED؛ المقارنة مع سعر الكتالوج الحالي لا سعر الشراء | يُتجاهل لـ PENDING/PAYMENT_FAILED/REFUNDED، والمقارنة مع `VipPurchase.amountCents` |
| 7 | `vip-payment-webhook` (FAILED) | حدث فشل متأخر يقلب اشتراكاً `REFUNDED`/`CANCELED` أو دفعة ناجحة إلى `PAYMENT_FAILED` | يُتجاهل في هذه الحالات |
| 8 | `vip-subscriptions` + webhook + `api/payments/capture` | تعديل سعر الباقة أثناء دفعة مفتوحة → `VIP_PAYMENT_AMOUNT_MISMATCH` (مال وصل بلا VIP) | التحقق مقابل لقطة الشراء (`VipPurchase`) لا سعر الكتالوج الحالي |
| 9 | `renewVipSubscription` | نفس الدفعة تُمدّد الاشتراك مرتين إن لم يصل `providerEventId`؛ مصدر التجديد `REFUNDED`/`EXPIRED` ينقل وقته المتبقي؛ حالات `REFUNDED/CANCELED` تُفعَّل من جديد | حارس نفس `paymentId`، الوقت يُنقل من مصدر `ACTIVE` فقط، إغلاق الحالات المغلقة، إلغاء المصدر بشرط `status = ACTIVE` |
| 10 | `activate/renew/refund/failed` | `P2034` (Serializable) يخرج كخطأ 500 عند تسليم webhook مزدوج | `runSerializable` يعيد المحاولة (`lib/db-serializable.ts`) |
| 11 | `getVipSubscriptionStatus` | `ORDER BY expiresAt DESC` يضع `NULL` أولاً في PostgreSQL → أي checkout معلّق **يخفي الاشتراك النشط** ويُعرض المشترك كمجاني؛ المنتهي بالتاريخ يظهر `NONE` | يُختار الاشتراك الفعّال أولاً، ثم آخر اشتراك مدفوع؛ وتظهر `EXPIRED` بشكل صحيح؛ checkouts غير المدفوعة تُتجاهل |
| 12 | `expireVipSubscription` | **لا أحد يستدعيها**: الاشتراكات المنتهية تبقى `ACTIVE` للأبد (لا حدث، لا إشعار، عدّاد الأدمن خاطئ)؛ ونسختان متباينتان من الدالة | نسخة واحدة بتحديث شرطي (لا تكرار إشعار)، `expireDueVipSubscriptions`، ومسار `GET /api/cron/vip-expiry` (مؤمَّن بـ `CRON_SECRET`) مضاف لـ `vercel.json`، وعدّادات الأدمن تستثني المنتهي |
| 13 | `api/vip/checkout` | checkout معلّق يمنع المستخدم من أي checkout آخر إلى الأبد؛ طلبان متزامنان بمفتاحين مختلفين ينشئان checkoutين؛ إعادة استخدام المفتاح لباقة أخرى يرجع checkout الباقة القديمة | انتهاء صلاحية المعلّق بعد 24 ساعة (إلى `PAYMENT_FAILED` لا `CANCELED` كي لا تضيع دفعة متأخرة)، إعادة فحص المعلّق داخل Serializable، رفض `VIP_IDEMPOTENCY_KEY_REUSED` |
| 14 | `app/rewards/page.tsx` | الـ Owner يُعرض بقيمة نقاط غير VIP | `isVip` يشمل SUPER_ADMIN |
| 15 | `api/admin/vip/plans` | لا يمكن للأدمن تعديل `gvcGrant` | حقل اختياري `gvcGrant` (0 لـ FREE/OWNER) |

## قرارات مقصودة (لم تُغيَّر)
- **نظام الرصيد موحّد (GVC):** أعمدة `chatCredits/imageCredits/videoCredits` قديمة، حُوّلت إلى `gvcBalance` بالـ migration `add_gvc_balance` ولا يقرأ منها أي مسار. تكلفة Chat/Image/Video تُحدَّد في `lib/ai/costs.ts` وتُسجَّل بنوعها في `AiCreditLedger.kind`.
- **الرصيد لا يُصفَّر عند انتهاء الاشتراك:** يبقى محفوظاً ولا يمكن صرفه دون VIP نشط (مفروض داخل transaction الخصم)، ويعود قابلاً للاستخدام عند الاشتراك مجدداً.
- **الاسترداد الجزئي** ما زال يرمي `VIP_PARTIAL_REFUND_UNSUPPORTED` (يُعاد webhook من المزوّد) — يحتاج قرارك.

## ملاحظات مفتوحة
- إيراد VIP لا يُسجَّل في `OwnerLedger` (مذكور في المرحلة 6، ينتظر قرارك المحاسبي).
- استرداد اشتراك جديد ورث وقتاً من اشتراك سابق (تجديد) لا يُرجع الوقت الموروث.
- `cancelVipSubscription` غير مستدعاة من أي واجهة حالياً (لا يوجد زر إلغاء للمستخدم)، وتقطع الوصول فوراً عند استدعائها.
- الإعداد المطلوب: `CRON_SECRET` (16 حرفاً فأكثر) في بيئة التشغيل ليعمل `/api/cron/vip-expiry`. على خطة Vercel المجانية يعمل مرة يومياً؛ للتشغيل الأسرع يمكن استدعاؤه من GitHub Actions كما هو الحال مع `trading-live-monitor`.

## بدون Migration
لا تغيير على المخطط ولا على قاعدة البيانات في هذه المرحلة.

## الاختبارات
أُضيف `tests/vip-credits.test.ts` و`tests/vip-subscription-flow.test.ts` (استهلاك الرصيد، المفاتيح المكررة، سحب GVC عند الاسترداد، الانتهاء، حالة الاشتراك، التفعيل والتجديد، إعادة المحاولة عند التعارض).
**لم تُشغَّل في بيئة الفحص** (تعذّر تثبيت الحزم: سجل npm محجوب)؛ فُحص الـ syntax فقط. شغّل `npm test` و`npx tsc --noEmit` عندك قبل النشر.
