# GameVortex Hub — Master Task Implementation Status

> **أرشيف تاريخي:** هذه الحالة كُتبت قبل اعتماد محركات AI المستضافة ذاتيًا. أي ذكر لمزودي AI خارجيين أو خطوات إعدادهم أدناه لم يعد دليلًا على بنية المشروع الحالية. المرجع التشغيلي المعتمد هو [`GAMEVORTEX_AI.md`](GAMEVORTEX_AI.md).

هذه الوثيقة هي سجل تنفيذ واقعي للنسخة الحالية من المشروع. تم استخدام المشروع الحالي كأساس، وليس إنشاء مشروع جديد.

## 1. ما تم تعديله في هذه الجولة

### Owner / SUPER_ADMIN
- تم توحيد صلاحية المالك على `role = SUPER_ADMIN` من الخادم.
- تم إزالة اعتماد `OWNER_EMAIL` كحاجز صلاحية داخل `requireOwner()`.
- بقي `OWNER_EMAIL` متاحًا فقط لمرحلة bootstrap/تهيئة أول حساب مالك، وليس كصلاحية وصول.
- تم توحيد نقاط حماية مسارات إصلاح قاعدة البيانات لتستخدم `requireOwner()`.
- تمت إضافة مركز تحكم مالك محمي: `/admin/owner-control`.
- تمت إضافة إدارة المستخدمين والأدوار: `/admin/users`.
- تمت إضافة إدارة/عرض VIP للمالك: `/admin/vip`.
- تمت إضافة صفحة إعدادات التكاملات بدون كشف الأسرار: `/admin/settings`.
- تمت إضافة API للـOwner Control وإدارة الأدوار مع AuditLog.
- تمت إضافة روابط هذه الأقسام إلى AdminShell.

### GameVortex AI
- توجد واجهة محادثة جديدة على `/ai` مع سجل محادثات مملوك للمستخدم وبث وإيقاف وإعادة توليد.
- يتصل الخادم بمحرك Ollama مستضاف ذاتيًا عبر بوابة GameVortex AI؛ لا يحتوي المشروع على أوزان نموذج.
- لا توجد أدوات موقع مسجلة للمحادثة، لذلك لا تمنح المحادثة صلاحية Admin أو Owner.
- إعداد المحرك البعيد يحتاج عنوان HTTPS ورمز البوابة في متغيرات Vercel السرية.
- التشغيل الحقيقي يتطلب تشغيل Ollama والنموذج على خادم تملكه؛ راجع [`GAMEVORTEX_AI.md`](GAMEVORTEX_AI.md) و[`../self-hosted-ai/README.md`](../self-hosted-ai/README.md).
- لا توجد ردود محفوظة بديلة عند غياب المحرك؛ تعرض الواجهة سبب الإعداد أو الاتصال.

## 2. أجزاء كبيرة موجودة أصلًا في المشروع وتم الحفاظ عليها

- Next.js + TypeScript + Prisma + PostgreSQL.
- Authentication/session cookie مع sessionVersion.
- RBAC للأدوار `SUPER_ADMIN / STAFF / USER`.
- Games catalog وGame Details.
- Favorites وWishlist.
- Game Library.
- Gamer Profile / Follow / Activity.
- Reviews وModeration foundations.
- Achievements / XP foundations.
- Rankings.
- Marketplace / Orders / Digital Keys.
- Payments وWebhook foundation.
- User Wallet + Wallet Deposits.
- Owner Wallet / Owner Ledger.
- Withdrawals foundation.
- VIP plans / subscriptions / rewards / purchases.
- GameVortex AI chat + conversations/messages على محرك Ollama ذاتي الاستضافة.
- Quran provider foundation.
- FazerCards integration foundation.
- RAWG/mobile game import foundation.
- Rate limiting / same-origin mutation protection.
- Audit logs / system errors / observability foundation.
- Prisma migrations.
- Unit tests وsmoke scripts.

## 3. قاعدة مهمة

وجود endpoint أو adapter في المصدر لا يعني أن التكامل الخارجي يعمل في الإنتاج. أي خدمة تحتاج API key أو webhook أو حساب خارجي تعتبر `CONFIGURED/VERIFIED` فقط بعد اختبارها في البيئة الفعلية.

لا يتم وضع مفاتيح الإنتاج داخل GitHub أو داخل Frontend.

## 4. المهام التي لا يمكن إثباتها من ZIP فقط

هذه تحتاج تنفيذًا يدويًا داخل Vercel/قاعدة البيانات/حسابات الخدمات:

1. تشغيل migrations على PostgreSQL الإنتاجي والتحقق من الحالة.
2. ضبط جميع Environment Variables في Vercel Production/Preview.
3. تشغيل بوابة Ollama الذاتية وربطها بVercel عبر HTTPS واختبار المحادثة من الموقع.
4. فحص وظائف الدفع والـwebhook باستخدام sandbox موثوق.
5. اختبار شراء VIP بأموال حقيقية أو sandbox موثوق.
6. اختبار refunds/chargebacks/reconciliation.
7. اختبار payout provider الحقيقي وسحب الأموال.
8. اختبار Quran provider credentials والـlicense/source policy.
9. اختبار RAWG catalog import بمفتاح حقيقي ومراجعة مصادر المتجر.
10. اختبار Steam OAuth/API الفعلي إذا تم تفعيل المسار.
11. أي Xbox/PlayStation/Nintendo integration تحتاج credentials/provider حقيقي.
12. Push notifications تحتاج provider حقيقي.
13. Email يحتاج Resend أو provider حقيقي مع domain verification.
14. CDN/storage/media retention يحتاج مزودًا حقيقيًا إذا كانت النتائج ستُخزن بشكل دائم.
15. Domain/DNS/HTTPS/Vercel production configuration.
16. External security assessment.
17. Legal/privacy/terms review.
18. Production operational approval.

## 5. المهام التي تم تجهيز الهيكل لها لكن تحتاج تنفيذ خارجي

### GameVortex AI
- Site action tools, memory, and usage metering remain disabled until separately designed and authorization-tested.
- Prompt-injection tests must continue to verify that chat cannot access site tools or privileged data.
- Model capacity and response quality require testing against the actual self-hosted model and host.

### Gaming Tracker / Social
- Public Collections.
- Collection sharing/reporting/moderation الكامل.
- Recently Viewed retention policy النهائي.
- Release/price alerts مع مصدر أسعار حقيقي.
- Deal Radar مع provider حقيقي.
- Price History مع مصدر حقيقي.
- Steam Import الكامل بعد credential/OAuth verification.
- Push notification delivery.
- Advanced community moderation.
- Export/delete data workflow النهائي.

### UI/UX
- Controllers المتقدمة للخلفيات/animation/glow/theme تحتاج مراجعة UI شاملة واختبار على أجهزة فعلية.
- Mobile/Tablet touch behavior يحتاج QA على أجهزة فعلية، وليس فقط viewport resize.
- Accessibility يحتاج اختبار keyboard + screen reader فعلي.
- Core Web Vitals تحتاج قياس Production/Preview فعلي.

## 6. لماذا لم يتم Fake هذه الأجزاء

لأن Fake payment/webhook/provider/trading/statistics سوف يجعل المشروع يبدو مكتملًا بينما هو غير قابل للاعتماد. هذا بالضبط النوع من المشاكل الذي نحاول منعه.

## 7. ترتيب الإغلاق النهائي

1. `npm ci`
2. `npm run db:validate`
3. `npm run db:generate`
4. `npm test`
5. `npm run typecheck`
6. `npm run build`
7. `npm run test:smoke`
8. تشغيل migrations على Preview DB.
9. تشغيل migrations على Production DB بعد backup.
10. ضبط Vercel Environment Variables.
11. تشغيل واختبار محرك GameVortex AI المستضاف ذاتيًا.
12. اختبار Payments/Webhooks.
13. اختبار Wallet/Withdrawals.
14. اختبار Marketplace fulfillment.
15. اختبار mobile/tablet/desktop.
16. Security regression.
17. Production smoke test.

## 8. صلاحيات Owner داخل GameVortex AI

المحادثة لا تملك أدوات أو صلاحيات خاصة. أي أدوات مستقبلية يجب أن تتحقق من جلسة المستخدم ودوره وصلاحيات الموقع على الخادم لكل عملية. دور `SUPER_ADMIN` لا يتجاوز تسجيل الدخول أو التفويض.
