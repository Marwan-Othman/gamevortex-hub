# المرحلة 18 — Error Handling (تقرير)

> الفحص كان ثابتًا (static) على الكود. لم يتم تشغيل `npm run typecheck` ولا `vitest` ولا `build` (لا يوجد npm/شبكة في بيئة العمل). شغّلها عندك قبل النشر.

## ما تم فحصه
127 API route، ~400 كتلة try، ~140 استدعاء fetch (سيرفر + واجهة)، error boundaries، ملفات loading.

## الإصلاحات
| البند | قبل | بعد |
|---|---|---|
| Routes بدون try/catch | 14 handler (search, quran, vip/plans, vip/rewards, marketplace, conversations, gamers, ai/usage, ai/admin/health, oauth providers, admin wallpapers, admin content GET) | كلها ملفوفة، تعيد JSON 500/503 + `requestId` |
| Server logs | `userRouteError` لا يسجّل شيئًا؛ login/register/OAuth/health تبتلع السبب | `logRouteError` (اسم الخطأ، كود Prisma، رسالة وstack مختصران ومنظّفان من الأسرار، requestId) |
| HTTP status | أي عطل → 400 أو 403 أو 401 | domain code → 401/403/404/409/429/503 حسب النوع؛ عطل غير متوقع → 500؛ انقطاع DB → 503 + Retry-After |
| `/api/auth/me` | أي عطل → 401 (يُظهر المستخدم كأنه خرج) | 401 فقط لغير المسجّل، وإلا 500/503 |
| كشف أسرار | سليم أصلًا (whitelist للأكواد) | بقي كذلك؛ جميع السجلات تمر عبر `redactSecrets` |
| Upstream fetch | Stripe/PayPal/payouts/email/Fazercards/Quran/Binance(قراءة)/Upstash بلا timeout | `fetchWithTimeout` (15s، الشراء 30s، Upstash 2s، Binance 10s) + `readJsonSafe` (صفحة HTML لا تتحول إلى SyntaxError مضلّل) |
| Rate limiter | عطل Upstash صامت | يسقط لمحدّد محلي + سجل مرة/دقيقة |
| Loading/Empty/Error | `/social`: تعلق على Loading أو تُظهر الخطأ كـ"فارغ"؛ المفضلة: خطأ غير ملتقط؛ logout يتظاهر بالنجاح؛ fetchMe يخزّن فشلًا عابرًا 30ث | الحالات الثلاث + إعادة محاولة، رسائل عربية، لا تخزين للفشل العابر |
| رسائل المستخدم | عرض أكواد إنجليزية خام أحيانًا | `lib/error-messages.ts` |
| Error boundary | بدون رمز مرجع/رابط رئيسية | digest + زر الرئيسية |
| أكواد fallback مضللة | `BAD_REQUEST`, `FAILED`, `UNAUTHORIZED` لأخطاء غير متوقعة | أكواد وصفية |

## ملفات جديدة
`lib/fetch-timeout.ts`, `lib/error-messages.ts`, `tests/error-handling.test.ts`

## اختبارات
- محدَّث: `tests/api-audit.test.ts` (الرد المقنَّع صار 500 + requestId).
- جديد: `tests/error-handling.test.ts` (status mapping، عدم تسريب الرسائل، 503، timeout، رسائل العميل، وفحص مصدر يمنع أي handler بدون try).
- نجحت: source-integrity، owner-role-policy، smoke، وفحص صياغة 257 ملف TS/TSX.

## ملاحظة سابقة للمرحلة
`test:env-contract` يفشل بسبب `POSTGRES_PASSWORD` في ملفي .env.example — لم ألمس هذه الملفات، والفشل موجود قبل هذه المرحلة.

## تنبيه
مهلة شراء Fazercards (30s): إن انتهت قد يكون الطلب نُفّذ عند المزوّد؛ استخدم Idempotency-Key عند إعادة المحاولة.

## لم يُعالج (للمرحلة التالية)
بعض routes الأدمن (owner-control, api-keys, support) ما زالت تُرجع 403 لأي خطأ داخل try واحد.
