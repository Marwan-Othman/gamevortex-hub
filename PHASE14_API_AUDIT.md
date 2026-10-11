# المرحلة 14 — API Audit

نطاق الفحص: كل `app/api/**/route.ts` — **125 endpoint / 175 handler**. فُحص لكل واحد: Authentication، Authorization، Input validation، Rate limiting، Database access، Error handling، Response format، Security، Idempotency، Logging.

## الطريقة
1. ماسح آلي لكل handler (المصادقة، الحماية، التحقق، الجداول، idempotency، التسجيل) ثم قراءة يدوية لكل route مشبوه.
2. مراجعة يدوية معمّقة: auth/*، me/*، wallet/*، wallpapers/*، ai/*، admin (المحتوى، الإشراف، المستخدمون)، payments/webhook، cron، v1.
3. المسارات المالية الكبرى (orders، checkout، vip، withdrawals، refunds) كانت مدقَّقة في المراحل 4–11؛ فُحصت هنا من ناحية المصادقة والحماية وتسريب الأخطاء فقط.

## أهم المشاكل التي وُجدت وأُصلحت
| # | الخطورة | المشكلة | الإصلاح |
|---|---|---|---|
| 1 | عالية | `POST /api/me/xp`: أي مستخدم يولّد XP/مستويات/إنجازات بلا حد بإرسال `gameId` عشوائي | يشترط لعبة منشورة وسجلًّا فعليًا للفعل؛ idempotent |
| 2 | عالية | `payments/webhook`: أي فشل غير متوقع (قاعدة بيانات) يُرجع 400 فيوقف المزوّد إعادة المحاولة → طلب مدفوع قد يضيع؛ body بلا حد؛ استثناء التحقق غير معالج | 500 قابل لإعادة المحاولة، حد 1MB، 503 عند تعذّر التحقق، 400 لـ JSON فاسد |
| 3 | عالية | ~60 route تُرجع `error.message` الخام (رسائل Prisma، أخطاء المزوّد، أسماء أسرار) للعميل | دالة مركزية `publicErrorCode` تمرّر الأكواد المقصودة فقط وتخفي الباقي وتسجّله في السيرفر؛ + اختبار آلي يمنع الرجوع |
| 4 | متوسطة | `rate limit` بالـ IP يمكن تجاوزه بتزوير `X-Forwarded-For` في النشر الذاتي (Docker/nginx) | متغير `TRUSTED_PROXY_HOPS` (يأخذ العنوان من اليمين)؛ الافتراضي لم يتغيّر (Vercel) |
| 5 | متوسطة | `me/follow`: إشعار عند كل POST (سبام) وتسريب بريد المتابِع عند غياب username | إشعار مرة واحدة فقط، بلا بريد |
| 6 | متوسطة | `wallet/transactions` و`wallet/deposit`: غير المسجّل يحصل على 500 | 401 صحيح |
| 7 | متوسطة | `me/gamer-profile`: روابط الصور تقبل أي نص (javascript:/data:) | https فقط |
| 8 | متوسطة | `admin/moderation`: حل البلاغ غير idempotent (ModerationAction مكرر) | تحديث مشروط PENDING→قرار + 404/409 |
| 9 | متوسطة | `reports`: لا dedupe ولا سقف | dedupe + سقف 50 مفتوح |
| 10 | متوسطة | `wallpapers/*` العامة (view/favorite/report/download/media) بلا CSRF/حد معدّل؛ عدّاد المشاهدات يُضخَّم | guardMutation/guardRead + مشاهدة/10 دقائق لكل عميل |
| 11 | متوسطة | `v1/games`: مفاتيح غير صالحة تضرب DB بلا حد | حد لكل IP + try/catch |
| 12 | متوسطة | `api-access/checkout`: مفتاح idempotency مختلف يفتح دفعة ثانية أثناء PENDING | إعادة استخدام checkout المفتوح |
| 13 | منخفضة | `support/tickets` بلا سقف، `ai/conversations` بلا سقف، `rankings` limit=NaN، `apps|games/[slug]` بلا try/catch، `admin/wallpapers/moderation` فشل المكافأة يمنع إعادة المحاولة، `owner/quran` كل الأخطاء 403، `admin/fazercards/test` يسرّب رسائل المزوّد | أُصلحت كلها |

## ملفات جديدة/معدّلة رئيسية
- `lib/api.ts`: `publicErrorCode`، `ownerRouteError`، تحسين `userRouteError`.
- `lib/security.ts`: `TRUSTED_PROXY_HOPS`.
- `tests/api-audit.test.ts` (جديد): يفحص آليًا — لا `error.message` خام، كل mutation يمر بـ guardMutation، كل handler غير عام يصادق. + حالات في `tests/security.test.ts`.
- `.env.example` / `.env.production.example`: `TRUSTED_PROXY_HOPS`.
- 70 ملف route معدّل في المجموع.

## ما لم يُفحص / يحتاج منك
- **لم أشغّل `tsc` ولا `vitest` ولا `next build`**: لا توجد شبكة لتثبيت الحزم. فُحصت صياغة TypeScript لكل الملفات (0 أخطاء) وتطابق الاستيرادات يدويًا. شغّل `npm ci && npm run typecheck && npm test` قبل الدمج.
- إن كنت تنشر على Docker/nginx اضبط `TRUSTED_PROXY_HOPS` (عادة 1).
- قيود rate limit الافتراضية في الذاكرة لكل instance؛ استخدم `RATE_LIMIT_STORE=upstash` عند تعدد النسخ.
- أربعة GET للتداول (exchange/*) للمالك فقط بلا guardRead (اختبار موجود يستدعيها بلا وسيط) — مقبول الآن.
- تسجيل الدخول: القفل لكل حساب (10/15 دقيقة) يسمح لمهاجم بإيقاف دخول ضحية مؤقتًا؛ مقايضة مقصودة وقائمة.
- `/api/me/xp` لا يستخدمه الـ frontend الحالي (الـ XP يُمنح من مسارات المفضلة/المكتبة نفسها).
- رسائل الأخطاء الجديدة أكواد ثابتة؛ قد يعرض الـ UI رسالة عامة بدل التفصيل في بعض حالات المالك (التفاصيل في سجلّ السيرفر).

## جدول التدقيق الكامل
Rate limit: `CSRF+RL` = guardMutation (فحص Origin + حد معدّل)، `RL` = guardRead.

| Endpoint | Method | Auth required | Role required | Input | Output | Database | Rate limit | Idempotency | Logging | Security risk | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| /api/admin/api-keys/[id] | PATCH | نعم | SUPER_ADMIN | Zod, path param | JSON | auditLog, gameVortexApiKey | CSRF+RL | — | AuditLog | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/admin/api-keys | GET | نعم | SUPER_ADMIN | — | JSON | gameVortexApiKey | RL | n/a | — | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/admin/api-keys | POST | نعم | SUPER_ADMIN | Zod, JSON body | JSON | auditLog, gameVortexApiKey, user | CSRF+RL | — | AuditLog, log | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/admin/content-health | GET | نعم | SUPER_ADMIN | — | JSON | app, game | RL | n/a | — | متوسط: كل الأخطاء 401 مع رسالة خام؛ بلا حد معدّل | 🔧 أُصلح |
| /api/admin/content/[type]/[id] | GET | نعم | SUPER_ADMIN | path param | JSON | عبر lib/* | RL | n/a | — | منخفض: GET بلا حد معدّل + أخطاء خام | 🔧 أُصلح |
| /api/admin/content/[type]/[id] | PATCH | نعم | SUPER_ADMIN | validator مخصّص, JSON body, path param | JSON | app, appCategory, appPlatform, game, gameCategory, gamePlatform | CSRF+RL | طبيعي | AuditLog, log | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/admin/content/[type]/[id] | DELETE | نعم | SUPER_ADMIN | path param | JSON | app, entitlement, game, orderItem | CSRF+RL | طبيعي | AuditLog, log | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/admin/content | POST | نعم | SUPER_ADMIN | validator مخصّص, JSON body | JSON | app, game | CSRF+RL | — | AuditLog, log | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/admin/content/upload | DELETE | نعم | SUPER_ADMIN | JSON body | JSON | عبر lib/* | CSRF+RL | طبيعي | log | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/admin/content/upload | POST | نعم | SUPER_ADMIN | JSON body | JSON | عبر lib/* | CSRF+RL | — | log | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/admin/draws/[id] | PATCH | نعم | SUPER_ADMIN | Zod, JSON body, path param | JSON | activity, auditLog, notification, raffle | CSRF+RL | — | AuditLog | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/admin/draws | GET | نعم | SUPER_ADMIN | — | JSON | raffle | RL | n/a | — | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/admin/draws | POST | نعم | SUPER_ADMIN | Zod, JSON body | JSON | auditLog, raffle | CSRF+RL | — | AuditLog | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/admin/fazercards/catalog | GET | نعم | SUPER_ADMIN | query | JSON | gameProduct | RL | n/a | log | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/admin/fazercards/import | POST | نعم | SUPER_ADMIN | Zod, JSON body | JSON | auditLog, game, gameProduct | CSRF+RL | طبيعي | AuditLog, log | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/admin/fazercards/test | GET | نعم | SUPER_ADMIN | — | JSON | عبر lib/* | RL | n/a | log | متوسط: تسريب رسائل المزوّد/الإعداد + requireUser يدوي | 🔧 أُصلح: requireOwner + guardRead + رموز ثابتة |
| /api/admin/fazercards/toggle | POST | نعم | SUPER_ADMIN | Zod, JSON body | JSON | auditLog, gameProduct | CSRF+RL | طبيعي | AuditLog, log | لا شيء ظاهر | ✅ سليم |
| /api/admin/games | GET | نعم | SUPER_ADMIN | query | JSON | game | RL | n/a | log | منخفض: بلا حد معدّل ولا سقف للنتائج | 🔧 أُصلح: guardRead + take 500 |
| /api/admin/moderation | GET | نعم | SUPER_ADMIN | — | JSON | contentReport | RL | n/a | — | متوسط: حل البلاغ غير idempotent (يُنشئ ModerationAction جديدًا عند كل إعادة) + 404/409 غائبان + تسريب Prisma | 🔧 أُصلح: تحديث مشروط PENDING→قرار داخل transaction |
| /api/admin/moderation | PATCH | نعم | SUPER_ADMIN | Zod, JSON body | JSON | contentReport, moderationAction | CSRF+RL | نعم (PENDING→قرار) | — | متوسط: حل البلاغ غير idempotent (يُنشئ ModerationAction جديدًا عند كل إعادة) + 404/409 غائبان + تسريب Prisma | 🔧 أُصلح: تحديث مشروط PENDING→قرار داخل transaction |
| /api/admin/mods | GET | نعم | SUPER_ADMIN | — | JSON | mod | RL | n/a | — | منخفض: failure() تُرجع error.message خامًا (500) | 🔧 أُصلح (+400 لـ Zod) |
| /api/admin/mods | POST | نعم | SUPER_ADMIN | Zod, JSON body | JSON | auditLog, game, mod | CSRF+RL | — | AuditLog | منخفض: failure() تُرجع error.message خامًا (500) | 🔧 أُصلح (+400 لـ Zod) |
| /api/admin/mods | PATCH | نعم | SUPER_ADMIN | Zod, JSON body, query | JSON | auditLog, mod | CSRF+RL | — | AuditLog | منخفض: failure() تُرجع error.message خامًا (500) | 🔧 أُصلح (+400 لـ Zod) |
| /api/admin/mods | DELETE | نعم | SUPER_ADMIN | query | JSON | auditLog, mod | CSRF+RL | طبيعي | AuditLog | منخفض: failure() تُرجع error.message خامًا (500) | 🔧 أُصلح (+400 لـ Zod) |
| /api/admin/orders/[id]/wallet-refund | POST | نعم | SUPER_ADMIN | path param | JSON | auditLog, digitalKey, notification, order, ownerLedger, ownerWallet… | CSRF+RL | نعم (مفتاح) | SystemError, AuditLog | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/admin/owner-control | GET | نعم | SUPER_ADMIN | — | JSON | contentReport, game, gameProduct, order, payment, systemError… | RL | n/a | — | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/admin/owner-control | PATCH | نعم | SUPER_ADMIN | Zod, JSON body | JSON | auditLog, user | CSRF+RL | — | AuditLog | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/admin/owner-wallet/reconcile | POST | نعم | SUPER_ADMIN | Zod, JSON body | JSON | auditLog, ownerLedger, ownerWallet | CSRF+RL | نعم (مفتاح) | SystemError, AuditLog | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/admin/products/[id]/keys | GET | نعم | SUPER_ADMIN | path param | JSON | digitalKey, gameProduct | RL | n/a | — | لا شيء ظاهر | ✅ سليم |
| /api/admin/products/[id]/keys | POST | نعم | SUPER_ADMIN | Zod, JSON body, path param | JSON | auditLog, digitalKey, gameProduct | CSRF+RL | — | AuditLog | لا شيء ظاهر | ✅ سليم |
| /api/admin/products/[id] | GET | نعم | SUPER_ADMIN | path param | JSON | gameProduct | RL | n/a | — | لا شيء ظاهر | ✅ سليم |
| /api/admin/products/[id] | PATCH | نعم | SUPER_ADMIN | Zod, JSON body, path param | JSON | auditLog, digitalKey, gameProduct | CSRF+RL | — | AuditLog, log | لا شيء ظاهر | ✅ سليم |
| /api/admin/products/[id] | DELETE | نعم | SUPER_ADMIN | path param | JSON | auditLog, digitalKey, gameProduct | CSRF+RL | طبيعي | AuditLog, log | لا شيء ظاهر | ✅ سليم |
| /api/admin/products | GET | نعم | SUPER_ADMIN | — | JSON | gameProduct | RL | n/a | — | لا شيء ظاهر | ✅ سليم |
| /api/admin/products | POST | نعم | SUPER_ADMIN | Zod, JSON body | JSON | auditLog, game, gameProduct | CSRF+RL | — | AuditLog, log | لا شيء ظاهر | ✅ سليم |
| /api/admin/support/tickets/[id] | GET | نعم | SUPER_ADMIN | path param | JSON | supportTicket | RL | n/a | — | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/admin/support/tickets/[id] | POST | نعم | SUPER_ADMIN | Zod, JSON body, path param | JSON | auditLog, notification, supportMessage, supportTicket | CSRF+RL | — | AuditLog | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/admin/support/tickets/[id] | PATCH | نعم | SUPER_ADMIN | Zod, JSON body, path param | JSON | auditLog, notification, supportTicket | CSRF+RL | — | AuditLog | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/admin/support/tickets | GET | نعم | SUPER_ADMIN | query | JSON | supportTicket | RL | n/a | — | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/admin/trading/allocations/[id]/release | POST | نعم | SUPER_ADMIN | path param | JSON | عبر lib/* | CSRF+RL | — | SystemError | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/admin/trading/allocations | GET | نعم | SUPER_ADMIN | — | JSON | عبر lib/* | RL | n/a | SystemError | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/admin/trading/allocations | POST | نعم | SUPER_ADMIN | JSON body | JSON | عبر lib/* | CSRF+RL | نعم (مفتاح) | SystemError | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/admin/trading/approvals/[id]/consume | POST | نعم | SUPER_ADMIN | JSON body, path param | JSON | عبر lib/* | CSRF+RL | — | SystemError | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/admin/trading/approvals/[id]/revoke | POST | نعم | SUPER_ADMIN | path param | JSON | عبر lib/* | CSRF+RL | — | SystemError | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/admin/trading/approvals | GET | نعم | SUPER_ADMIN | — | JSON | عبر lib/* | RL | n/a | SystemError | لا شيء ظاهر | ✅ سليم |
| /api/admin/trading/approvals | POST | نعم | SUPER_ADMIN | — | JSON | auditLog | CSRF+RL | — | SystemError, AuditLog | لا شيء ظاهر | ✅ سليم |
| /api/admin/trading/audit | GET | نعم | SUPER_ADMIN | query | JSON | auditLog | RL | n/a | AuditLog | لا شيء ظاهر | ✅ سليم |
| /api/admin/trading/backtest/lab | POST | نعم | SUPER_ADMIN | — | JSON | عبر lib/* | CSRF+RL | — | — | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/admin/trading/backtest | POST | نعم | SUPER_ADMIN | — | JSON | عبر lib/* | CSRF+RL | — | — | لا شيء ظاهر | ✅ سليم |
| /api/admin/trading/backtest/sweep | POST | نعم | SUPER_ADMIN | — | JSON | عبر lib/* | CSRF+RL | — | — | لا شيء ظاهر | ✅ سليم |
| /api/admin/trading/capital-reconciliation | GET | نعم | SUPER_ADMIN | — | JSON | عبر lib/* | RL | n/a | SystemError | لا شيء ظاهر | ✅ سليم |
| /api/admin/trading/control | GET | نعم | SUPER_ADMIN | — | JSON | عبر lib/* | RL | n/a | — | لا شيء ظاهر | ✅ سليم |
| /api/admin/trading/control | POST | نعم | SUPER_ADMIN | — | JSON | عبر lib/* | CSRF+RL | — | — | لا شيء ظاهر | ✅ سليم |
| /api/admin/trading/exchange/live/preflight | GET | نعم | SUPER_ADMIN | — | JSON | عبر lib/* | لا | n/a | — | مقبول: للمالك فقط؛ لا guardRead (لكل استدعاء كلفة على Binance) — يُنصح بإضافته لاحقًا (اختبار الوحدة الحالي يستدعي GET() بلا وسيط). | ⚠️ مقبول |
| /api/admin/trading/exchange/public/market-data | GET | نعم | SUPER_ADMIN | query | JSON | عبر lib/* | لا | n/a | — | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/admin/trading/exchange/testnet/market-data | GET | نعم | SUPER_ADMIN | query | JSON | عبر lib/* | لا | n/a | — | مقبول: للمالك فقط، بلا guardRead. | ⚠️ مقبول |
| /api/admin/trading/exchange/testnet/preflight | POST | نعم | SUPER_ADMIN | — | JSON | عبر lib/* | CSRF+RL | — | — | لا شيء ظاهر | ✅ سليم |
| /api/admin/trading/exchange/testnet/status | GET | نعم | SUPER_ADMIN | — | JSON | عبر lib/* | لا | n/a | — | مقبول: كما أعلاه (اختبار route.test.ts يستدعي GET() بلا وسيط). | ⚠️ مقبول |
| /api/admin/trading/live/execute | POST | نعم | SUPER_ADMIN | JSON body | JSON | عبر lib/* | CSRF+RL | — | SystemError | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/admin/trading/live/orders | GET | نعم | SUPER_ADMIN | — | JSON | عبر lib/* | RL | n/a | — | لا شيء ظاهر | ✅ سليم |
| /api/admin/trading/live/orders | POST | نعم | SUPER_ADMIN | — | JSON | عبر lib/* | CSRF+RL | — | — | لا شيء ظاهر | ✅ سليم |
| /api/admin/trading/live/prepare | POST | نعم | SUPER_ADMIN | — | JSON | عبر lib/* | CSRF+RL | — | — | لا شيء ظاهر | ✅ سليم |
| /api/admin/trading/opportunity | POST | نعم | SUPER_ADMIN | — | JSON | عبر lib/* | CSRF+RL | — | — | لا شيء ظاهر | ✅ سليم |
| /api/admin/trading/paper | POST | نعم | SUPER_ADMIN | — | JSON | auditLog | CSRF+RL | — | AuditLog | لا شيء ظاهر | ✅ سليم |
| /api/admin/trading/risk-config | GET | نعم | SUPER_ADMIN | — | JSON | عبر lib/* | RL | n/a | — | لا شيء ظاهر | ✅ سليم |
| /api/admin/trading/risk-config | PUT | نعم | SUPER_ADMIN | — | JSON | عبر lib/* | CSRF+RL | — | — | لا شيء ظاهر | ✅ سليم |
| /api/admin/trading/shariah/check | POST | نعم | SUPER_ADMIN | — | JSON | عبر lib/* | CSRF+RL | — | — | لا شيء ظاهر | ✅ سليم |
| /api/admin/trading/status | GET | نعم | SUPER_ADMIN | — | JSON | عبر lib/* | RL | n/a | SystemError | لا شيء ظاهر | ✅ سليم |
| /api/admin/users | GET | نعم | SUPER_ADMIN | — | JSON | user | RL | n/a | — | منخفض: تحويل أي خطأ إلى 403 مع نصه | 🔧 أُصلح: ownerRouteError |
| /api/admin/vip/plans | GET | نعم | SUPER_ADMIN | — | JSON | vipPlan | RL | n/a | — | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/admin/vip/plans | PATCH | نعم | SUPER_ADMIN | Zod, JSON body | JSON | vipPlan | CSRF+RL | — | — | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/admin/vip/rewards | GET | نعم | SUPER_ADMIN | — | JSON | vipReward | RL | n/a | — | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/admin/vip/rewards | POST | نعم | SUPER_ADMIN | Zod, JSON body | JSON | vipPlan, vipReward | CSRF+RL | — | — | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/admin/wallpapers/cleanup | POST | نعم | SUPER_ADMIN | JSON body | JSON | عبر lib/* | CSRF+RL | — | — | لا شيء ظاهر | ✅ سليم |
| /api/admin/wallpapers/download-zip | POST | نعم | SUPER_ADMIN | JSON body | ZIP stream | wallpaper | CSRF+RL | طبيعي | log | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/admin/wallpapers/moderation | GET | نعم | SUPER_ADMIN | — | JSON | wallpaper | RL | n/a | log | متوسط: تسريب رسائل + فشل منح النقاط بعد الاعتماد يُرجع خطأ ولا يمكن إعادة المحاولة (ALREADY_REVIEWED) | 🔧 أُصلح: المكافأة غير حرجة + تسجيل + rewardPending |
| /api/admin/wallpapers/moderation | PATCH | نعم | SUPER_ADMIN | JSON body | JSON | wallpaper | CSRF+RL | نعم (مفتاح) | SystemError | متوسط: تسريب رسائل + فشل منح النقاط بعد الاعتماد يُرجع خطأ ولا يمكن إعادة المحاولة (ALREADY_REVIEWED) | 🔧 أُصلح: المكافأة غير حرجة + تسجيل + rewardPending |
| /api/admin/wallpapers | GET | نعم | SUPER_ADMIN | query | JSON | wallpaper | RL | n/a | — | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/admin/wallpapers | POST | نعم | SUPER_ADMIN | JSON body | JSON | wallpaper | CSRF+RL | — | log | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/admin/wallpapers | PATCH | نعم | SUPER_ADMIN | JSON body | JSON | wallpaper | CSRF+RL | طبيعي | log | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/admin/wallpapers | DELETE | نعم | SUPER_ADMIN | JSON body, query | JSON | wallpaper | CSRF+RL | طبيعي | log | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/admin/wallpapers/upload | POST | نعم | SUPER_ADMIN | JSON body | JSON | عبر lib/* | CSRF+RL | — | log | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/admin/withdrawals/[id] | PATCH | نعم | SUPER_ADMIN | Zod, JSON body, path param | JSON | auditLog, ownerLedger, ownerWallet, withdrawalRequest | CSRF+RL | نعم (مفتاح) | SystemError, AuditLog | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/ai/admin/health | GET | نعم | SUPER_ADMIN | — | JSON | aiUsageLedger | RL | n/a | — | لا شيء ظاهر | ✅ سليم |
| /api/ai/chat | POST | نعم | USER | JSON body | JSON | عبر lib/* | CSRF+RL | نعم (مفتاح) | — | لا شيء ظاهر | ✅ سليم |
| /api/ai/image | POST | نعم | USER | JSON body | Binary/stream | عبر lib/* | CSRF+RL | نعم (مفتاح) | — | لا شيء ظاهر | ✅ سليم |
| /api/ai/usage | GET | نعم | USER | — | JSON | aiCreditBalance, aiUsageLedger | RL | n/a | — | لا شيء ظاهر | ✅ سليم |
| /api/ai/video/file | GET | نعم | USER | query | Binary/stream | عبر lib/* | RL | n/a | — | لا شيء ظاهر | ✅ سليم |
| /api/ai/video | POST | نعم | USER | JSON body | JSON | عبر lib/* | CSRF+RL | نعم (مفتاح) | — | لا شيء ظاهر | ✅ سليم |
| /api/ai/video/status | GET | نعم | USER | query | JSON | عبر lib/* | RL | n/a | — | لا شيء ظاهر | ✅ سليم |
| /api/api-access/checkout | POST | نعم | USER | Zod, JSON body | JSON | apiAccessPurchase | CSRF+RL | نعم (مفتاح) | log | متوسط: مفتاح idempotency مختلف يفتح دفعة ثانية أثناء وجود PENDING (دفع مزدوج محتمل) | 🔧 أُصلح: إعادة استخدام checkout المفتوح (30 دقيقة) |
| /api/apps/[slug] | GET | لا | عام | path param | JSON | app | RL | n/a | log | منخفض: استثناء DB غير معالج + عدّاد المشاهدات قد يُسقط الصفحة | 🔧 أُصلح |
| /api/apps | GET | لا | عام | query | JSON | app | RL | n/a | log | لا شيء ظاهر | ✅ سليم |
| /api/auth/login | POST | لا | عام | Zod, JSON body | JSON | user, xpEvent | CSRF+RL | — | — | لا شيء ظاهر | ✅ سليم |
| /api/auth/logout | POST | لا | عام | — | JSON | عبر lib/* | CSRF+RL | — | — | لا شيء ظاهر | ✅ سليم |
| /api/auth/me | GET | نعم | USER | — | JSON | عبر lib/* | RL | n/a | — | لا شيء ظاهر | ✅ سليم |
| /api/auth/oauth/[provider]/callback | GET | لا | عام | path param | Redirect | عبر lib/* | RL | n/a | — | لا شيء ظاهر | ✅ سليم |
| /api/auth/oauth/[provider]/callback | POST | لا | عام | path param, form | Redirect | عبر lib/* | RL | — | — | لا شيء ظاهر | ✅ سليم |
| /api/auth/oauth/[provider] | GET | لا | عام | path param | Redirect | عبر lib/* | RL | n/a | — | لا شيء ظاهر | ✅ سليم |
| /api/auth/oauth/providers | GET | لا | عام | — | JSON | عبر lib/* | لا | n/a | — | لا شيء ظاهر | ✅ سليم |
| /api/auth/register | POST | لا | عام | Zod, JSON body | JSON | user | CSRF+RL | — | — | لا شيء ظاهر | ✅ سليم |
| /api/client-error | POST | اختياري | عام | Zod, JSON body | JSON | عبر lib/* | RL | — | SystemError | لا شيء ظاهر | ✅ سليم |
| /api/cron/trading-live-monitor | GET | Cron secret | — | — | JSON | عبر lib/* | سرّ Cron | n/a | SystemError | لا شيء ظاهر | ✅ سليم |
| /api/cron/vip-expiry | GET | Cron secret | — | — | JSON | عبر lib/* | سرّ Cron | n/a | SystemError | لا شيء ظاهر | ✅ سليم |
| /api/draws/[id]/enter | POST | نعم | USER | Zod, JSON body, path param | JSON | activity, notification, raffle, raffleEntry, raffleEntryRequest | CSRF+RL | نعم (مفتاح) | — | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/gamers/[username] | GET | لا | عام | path param | JSON | activity, user, userAchievement | RL | n/a | — | لا شيء ظاهر | ✅ سليم |
| /api/games/[slug]/reviews | GET | نعم | USER | path param | JSON | game, review | لا | n/a | — | منخفض: رسائل Zod الخام + حالات خطأ غير دقيقة | 🔧 أُصلح |
| /api/games/[slug]/reviews | POST | نعم | USER | Zod, JSON body, path param | JSON | auditLog, game, review | CSRF+RL | طبيعي | AuditLog | منخفض: رسائل Zod الخام + حالات خطأ غير دقيقة | 🔧 أُصلح |
| /api/games/[slug] | GET | لا | عام | path param | JSON | game | RL | n/a | log | منخفض: استثناء DB غير معالج + عدّاد المشاهدات قد يُسقط الصفحة | 🔧 أُصلح |
| /api/games | GET | لا | عام | query | JSON | game | RL | n/a | log | لا شيء ظاهر | ✅ سليم |
| /api/gamevortex-ai/conversations/[id] | GET | نعم | USER | path param | JSON | gameVortexAiConversation | RL | n/a | — | لا شيء ظاهر | ✅ سليم |
| /api/gamevortex-ai/conversations/[id] | PATCH | نعم | USER | JSON body, path param | JSON | gameVortexAiConversation | CSRF+RL | طبيعي | — | لا شيء ظاهر | ✅ سليم |
| /api/gamevortex-ai/conversations/[id] | DELETE | نعم | USER | path param | JSON | gameVortexAiConversation | CSRF+RL | طبيعي | — | لا شيء ظاهر | ✅ سليم |
| /api/gamevortex-ai/conversations | GET | نعم | USER | — | JSON | gameVortexAiConversation | RL | n/a | — | منخفض: إنشاء محادثات بلا سقف لكل مستخدم | 🔧 أُصلح: سقف 200 |
| /api/gamevortex-ai/conversations | POST | نعم | USER | JSON body | JSON | gameVortexAiConversation | CSRF+RL | — | — | منخفض: إنشاء محادثات بلا سقف لكل مستخدم | 🔧 أُصلح: سقف 200 |
| /api/health | GET | اختياري (x-admin-health) | عام / SUPER_ADMIN للتفاصيل | — | JSON | عبر lib/* | RL | n/a | — | لا شيء ظاهر | ✅ سليم |
| /api/marketplace/products | GET | لا | عام | — | JSON | gameProduct | RL | n/a | — | لا شيء ظاهر | ✅ سليم |
| /api/me/api-keys/[id] | DELETE | نعم | USER | path param | JSON | gameVortexApiKey | CSRF+RL | طبيعي | — | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/me/api-keys | GET | نعم | USER | — | JSON | apiAccessPurchase, gameVortexApiKey | RL | n/a | — | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/me/api-keys | POST | نعم | USER | Zod, JSON body | JSON | apiAccessPurchase, gameVortexApiKey | CSRF+RL | — | — | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/me/feed | GET | نعم | USER | — | JSON | activity, userFollow | RL | n/a | — | منخفض: أي خطأ = 401 بنص خام | 🔧 أُصلح |
| /api/me/follow/[username] | GET | نعم | USER | path param | JSON | user, userFollow | RL | n/a | — | متوسط: إشعار جديد عند كل POST (سبام للمستهدف) + تسريب بريد المتابِع في نص الإشعار عند غياب username | 🔧 أُصلح: إشعار مرة واحدة لكل متابِع ولمتابعة جديدة فقط، بلا بريد |
| /api/me/follow/[username] | POST | نعم | USER | path param | JSON | notification, user, userFollow | CSRF+RL | طبيعي | — | متوسط: إشعار جديد عند كل POST (سبام للمستهدف) + تسريب بريد المتابِع في نص الإشعار عند غياب username | 🔧 أُصلح: إشعار مرة واحدة لكل متابِع ولمتابعة جديدة فقط، بلا بريد |
| /api/me/follow/[username] | DELETE | نعم | USER | path param | JSON | user, userFollow | CSRF+RL | طبيعي | — | متوسط: إشعار جديد عند كل POST (سبام للمستهدف) + تسريب بريد المتابِع في نص الإشعار عند غياب username | 🔧 أُصلح: إشعار مرة واحدة لكل متابِع ولمتابعة جديدة فقط، بلا بريد |
| /api/me/gamer-profile | GET | نعم | USER | — | JSON | userAchievement | RL | n/a | — | متوسط: avatarUrl/bannerUrl قبلت أي نص (javascript:/data:/تتبّع)؛ GET بلا حد معدّل | 🔧 أُصلح: https فقط + guardRead |
| /api/me/gamer-profile | PATCH | نعم | USER | JSON body | JSON | gamerProfile | CSRF+RL | طبيعي | — | متوسط: avatarUrl/bannerUrl قبلت أي نص (javascript:/data:/تتبّع)؛ GET بلا حد معدّل | 🔧 أُصلح: https فقط + guardRead |
| /api/me/games/favorites | GET | نعم | USER | — | JSON | favoriteGame | RL | n/a | — | لا شيء ظاهر | ✅ سليم |
| /api/me/games/favorites | POST | نعم | USER | JSON body | JSON | favoriteGame, game | CSRF+RL | طبيعي | — | لا شيء ظاهر | ✅ سليم |
| /api/me/games/favorites | DELETE | نعم | USER | query | JSON | favoriteGame | CSRF+RL | طبيعي | — | لا شيء ظاهر | ✅ سليم |
| /api/me/games/library | GET | نعم | USER | query | JSON | gameLibraryItem | RL | n/a | — | لا شيء ظاهر | ✅ سليم |
| /api/me/games/library | POST | نعم | USER | JSON body | JSON | game, gameLibraryItem | CSRF+RL | طبيعي | — | لا شيء ظاهر | ✅ سليم |
| /api/me/games/library | DELETE | نعم | USER | query | JSON | gameLibraryItem | CSRF+RL | طبيعي | — | لا شيء ظاهر | ✅ سليم |
| /api/me/games/wishlist | GET | نعم | USER | — | JSON | wishlistGame | RL | n/a | — | لا شيء ظاهر | ✅ سليم |
| /api/me/games/wishlist | POST | نعم | USER | JSON body | JSON | game, wishlistGame | CSRF+RL | طبيعي | — | لا شيء ظاهر | ✅ سليم |
| /api/me/games/wishlist | DELETE | نعم | USER | query | JSON | wishlistGame | CSRF+RL | طبيعي | — | لا شيء ظاهر | ✅ سليم |
| /api/me/notifications | GET | نعم | USER | — | JSON | notification | RL | n/a | — | منخفض: أي خطأ = 401/400 بنص خام | 🔧 أُصلح |
| /api/me/notifications | PATCH | نعم | USER | Zod, JSON body | JSON | notification | CSRF+RL | طبيعي | — | منخفض: أي خطأ = 401/400 بنص خام | 🔧 أُصلح |
| /api/me/orders/[id]/checkout | POST | نعم | USER | Zod, path param | JSON | order, payment | CSRF+RL | نعم (مفتاح) | SystemError | لا شيء ظاهر | ✅ سليم |
| /api/me/orders/[id]/keys | GET | نعم | USER | Zod, path param | JSON | order | RL | n/a | — | لا شيء ظاهر | ✅ سليم |
| /api/me/orders/[id]/wallet-checkout | POST | نعم | USER | path param | JSON | order, payment, wallet, walletTransaction | CSRF+RL | نعم (مفتاح) | SystemError | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/me/orders | GET | نعم | USER | — | JSON | order | RL | n/a | — | لا شيء ظاهر | ✅ سليم |
| /api/me/orders | POST | نعم | USER | Zod, JSON body | JSON | digitalKey, entitlement, gameProduct, order, orderItem | CSRF+RL | نعم (مفتاح) | log | لا شيء ظاهر | ✅ سليم |
| /api/me/recommendations | GET | نعم | USER | — | JSON | favoriteGame, game, gameLibraryItem, wishlistGame | RL | n/a | — | منخفض: أي خطأ = 401 بنص خام | 🔧 أُصلح |
| /api/me/referrals | GET | نعم | USER | — | JSON | referral | RL | n/a | — | منخفض: أي خطأ = 401 بنص خام | 🔧 أُصلح |
| /api/me/xp | POST | نعم | USER | JSON body | JSON | game | CSRF+RL | نعم (مستخدم+فعل+لعبة) | — | عالٍ: توليد XP/مستويات/إنجازات بلا حد عبر gameId عشوائي (لا تحقق من اللعبة ولا من الفعل) | 🔧 أُصلح: يشترط لعبة منشورة + سجلًّا فعليًا (مفضلة/قائمة أمنيات/مراجعة/مكتبة/BEATEN) + idempotent |
| /api/owner/quran/reciters | GET | نعم | SUPER_ADMIN | — | JSON | quranReciter | RL | n/a | — | منخفض: كل الأخطاء 403 (حتى أخطاء DB/Zod) وبنص خام | 🔧 أُصلح: 401/403/400/404/409/500 صحيحة |
| /api/owner/quran/reciters | POST | نعم | SUPER_ADMIN | Zod, JSON body | JSON | auditLog, quranReciter | CSRF+RL | — | AuditLog | منخفض: كل الأخطاء 403 (حتى أخطاء DB/Zod) وبنص خام | 🔧 أُصلح: 401/403/400/404/409/500 صحيحة |
| /api/owner/quran/reciters | PATCH | نعم | SUPER_ADMIN | Zod, JSON body | JSON | auditLog, quranReciter | CSRF+RL | — | AuditLog | منخفض: كل الأخطاء 403 (حتى أخطاء DB/Zod) وبنص خام | 🔧 أُصلح: 401/403/400/404/409/500 صحيحة |
| /api/owner/quran/reciters | DELETE | نعم | SUPER_ADMIN | Zod, query | JSON | auditLog, quranReciter | CSRF+RL | طبيعي | AuditLog | منخفض: كل الأخطاء 403 (حتى أخطاء DB/Zod) وبنص خام | 🔧 أُصلح: 401/403/400/404/409/500 صحيحة |
| /api/owner/withdraw | POST | نعم | SUPER_ADMIN | JSON body | JSON | auditLog, ownerLedger, ownerWallet, withdrawalRequest | CSRF+RL | نعم (مفتاح) | SystemError, AuditLog | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/payments/capture | POST | نعم | USER | Zod, JSON body | JSON | apiAccessPurchase, order, payment, vipSubscription, walletDeposit | CSRF+RL | — | — | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/payments/webhook | POST | توقيع المزوّد | — | Zod, raw body | JSON | apiAccessPurchase, auditLog, digitalKey, order, payment, vipSubscription | RL (مخصّص) | نعم (إزالة تكرار الأحداث) | SystemError, AuditLog | عالٍ: أي فشل غير متوقع يُرجع 400 فيوقف المزوّد إعادة المحاولة (خسارة طلب مدفوع) + قراءة body غير محدودة + استثناء التحقق غير معالج | 🔧 أُصلح: 500 قابل لإعادة المحاولة، حد 1MB، 503 عند تعذّر التحقق، 400 لـ JSON فاسد |
| /api/quran/audio | GET | لا | عام | query | JSON | quranReciter | RL | n/a | — | لا شيء ظاهر | ✅ سليم |
| /api/quran/reciters | GET | لا | عام | — | JSON | quranReciter | RL | n/a | — | لا شيء ظاهر | ✅ سليم |
| /api/rankings | GET | لا | عام | query | JSON | عبر lib/* | RL | n/a | log | منخفض: limit=NaN يكسر take؛ category غير مقيّدة | 🔧 أُصلح |
| /api/reports | POST | نعم | USER | Zod, JSON body | JSON | contentReport | CSRF+RL | نعم (dedupe) | — | متوسط: لا منع تكرار ولا سقف للبلاغات المفتوحة + رسالة Prisma تُسرّب | 🔧 أُصلح: dedupe (idempotent) + سقف 50 + أخطاء مقنّعة |
| /api/search | GET | لا | عام | query | JSON | app, game | RL | n/a | — | لا شيء ظاهر | ✅ سليم |
| /api/support/tickets/[id] | GET | نعم | USER | path param | JSON | supportTicket | RL | n/a | — | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/support/tickets/[id] | POST | نعم | SUPER_ADMIN | Zod, JSON body, path param | JSON | notification, supportMessage, supportTicket, user | CSRF+RL | — | — | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/support/tickets | GET | نعم | USER | — | JSON | supportTicket | RL | n/a | — | متوسط: تذاكر مفتوحة غير محدودة + خطأ 500 بنص خام | 🔧 أُصلح: سقف 20 تذكرة مفتوحة |
| /api/support/tickets | POST | نعم | SUPER_ADMIN | Zod, JSON body | JSON | notification, supportTicket, user | CSRF+RL | — | — | متوسط: تذاكر مفتوحة غير محدودة + خطأ 500 بنص خام | 🔧 أُصلح: سقف 20 تذكرة مفتوحة |
| /api/v1/games | GET | API key (Bearer) | مفتاح مدفوع | query | JSON | apiAccessPurchase, game, gameVortexApiKey, gameVortexApiRequestLog | RL (مخصّص) | n/a | — | متوسط: مفاتيح غير موجودة/ملغاة لا تُحدّ (استعلام DB غير محدود) + استثناء DB غير معالج | 🔧 أُصلح: حد لكل IP + try/catch |
| /api/vip/checkout | POST | نعم | SUPER_ADMIN | Zod, JSON body | JSON | vipPlan, vipPurchase, vipSubscription, vipSubscriptionEvent | CSRF+RL | نعم (مفتاح) | log | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/vip/plans | GET | اختياري | عام | — | JSON | vipPlan | RL | n/a | — | لا شيء ظاهر | ✅ سليم |
| /api/vip/rewards | GET | لا | عام | — | JSON | vipReward | RL | n/a | — | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/vip/rewards | POST | نعم | USER | Zod, JSON body | JSON | notification, vipReward, vipRewardClaim, vipSubscription | CSRF+RL | نعم (مفتاح) | — | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/vip/status | GET | نعم | USER | — | JSON | عبر lib/* | RL | n/a | — | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |
| /api/wallet/deposit | POST | نعم | USER | Zod, JSON body, query | JSON | wallet, walletDeposit | CSRF+RL | نعم (مفتاح) | — | متوسط: requireUser خارج try (500) + رسالة خطأ المزوّد تصل للعميل | 🔧 أُصلح |
| /api/wallet/transactions | GET | نعم | USER | — | JSON | wallet, walletTransaction | RL | n/a | — | متوسط: requireUser خارج try → 500 بدل 401 لغير المسجل | 🔧 أُصلح |
| /api/wallpapers/[id]/download | GET | VIP فقط للمحتوى VIP | عام / VIP | path param | Binary/stream | wallpaper | RL | n/a | log | متوسط: بروكسي تنزيل بلا حد معدّل (استنزاف نطاق/عدّاد) | 🔧 أُصلح: guardRead 30/دقيقة |
| /api/wallpapers/[id]/favorite | POST | نعم | USER | path param | JSON | wallpaper, wallpaperFavorite | CSRF+RL | طبيعي | log | متوسط: بلا CSRF/حد معدّل + سباق create→P2002 يعطي 500 | 🔧 أُصلح: guardMutation + deleteMany/create آمن للسباق |
| /api/wallpapers/[id]/media | GET | VIP فقط للمحتوى VIP | عام / VIP | path param | Binary/stream | wallpaper | RL | n/a | log | منخفض: بلا حد معدّل | 🔧 أُصلح: guardRead 240/دقيقة |
| /api/wallpapers/[id]/report | POST | نعم | USER | JSON body, path param | JSON | wallpaper, wallpaperReport | CSRF+RL | — | — | متوسط: بلا CSRF/حد معدّل ولا سقف للبلاغات | 🔧 أُصلح: guardMutation + سقف 50 |
| /api/wallpapers/[id]/view | POST | لا | عام | path param | JSON | wallpaper | RL (مخصّص) | — | log | عالٍ(منخفض الأثر): عدّاد مشاهدات يُضخَّم بلا مصادقة ولا حد معدّل | 🔧 أُصلح: حد عام + مشاهدة واحدة/10 دقائق لكل عميل/خلفية |
| /api/wallpapers/upload | POST | نعم | SUPER_ADMIN | JSON body | JSON | wallpaper | CSRF+RL | — | — | متوسط-منخفض: رسالة error.message الخام قد تصل للعميل (Prisma/مزوّد) | 🔧 أُصلح: publicErrorCode (أكواد مقصودة فقط) |