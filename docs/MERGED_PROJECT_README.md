# GameVortex Hub — Merged Project

هذا الإصدار يدمج **Working Code** الحالي مع **Production Specification** في مشروع واحد.

## قاعدة الدمج
- الكود الحالي هو الأساس البرمجي، ولا يتم إنشاء مشروع منفصل.
- المواصفات أصبحت المرجع التنفيذي داخل `docs/Production-Specification-Original.txt`.
- أي ميزة لا تملك Integration حقيقية تبقى `NOT_CONFIGURED` أو `NEEDS_INTEGRATION` بدل Fake implementation.
- لا يتم حذف الوظائف الحالية السليمة.
- عند إضافة Feature يجب توسيع Model/API/Page الموجود بدل إنشاء نسخة مكررة.
- العمليات الحساسة يجب أن تبقى Server-side مع Transactions/Idempotency/Audit Logs.

## الحالة الحالية
هذا **Merged Foundation** وليس ادعاءً بأن كل 95 مرحلة في المواصفات قد نُفذت. الكود الأصلي ما زال يحتوي على Games, Rankings, Game Library Core, Quran Reciters/Audio, Owner Wallet/Points/Withdrawal Core وAudit Logs، بينما الميزات التي تتطلب خدمات خارجية (AI, Payments/Payout, Steam, Deal providers, Gift-card inventory, real authentication) تبقى غير مكوّنة.

## التشغيل
1. انسخ `.env.example` إلى `.env`.
2. اضبط `DATABASE_URL`.
3. اضبط مزود Authentication الحقيقي قبل الإنتاج؛ `DEV_USER_ID` مخصص للاختبار فقط.
4. شغّل `npm install`.
5. شغّل `npm run db:generate` ثم `npm run db:migrate`.
6. شغّل `npm run dev`.

## تحقق قبل Production
- Build + Type Check
- Database/Migration check
- Authentication/RBAC
- IDOR/Privilege Escalation
- CSRF/XSS/Injection
- Rate Limiting
- Webhook/Idempotency
- Wallet/Payment/Download authorization
- Accessibility/Mobile/Performance
- AI Safety
- Regression + Final QA

انظر أيضًا إلى:
- `docs/FEATURE-MATRIX.md`
- `docs/IMPLEMENTATION-ROADMAP.md`
- `docs/Production-Specification-Original.txt`
- `config/feature-flags.json`
