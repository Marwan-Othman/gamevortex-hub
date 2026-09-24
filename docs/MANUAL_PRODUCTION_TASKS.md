# GameVortex Hub — Manual / External Tasks

هذه هي الأعمال التي لا يصح تنفيذها أو الادعاء باكتمالها من ملف ZIP فقط.

## A. Vercel + Production

- [ ] ضبط Node.js 22.x في Vercel.
- [ ] ضبط `DATABASE_URL` على PostgreSQL الإنتاجي.
- [ ] ضبط `AUTH_SECRET` قوي وعشوائي.
- [ ] ضبط `APP_ORIGIN` على الدومين الحقيقي.
- [ ] ضبط owner bootstrap variables حسب الحاجة.
- [ ] تشغيل `prisma migrate deploy` على قاعدة Preview ثم Production.
- [ ] التأكد من عدم وجود migrations pending.
- [ ] أخذ backup قبل migrations الإنتاجية.
- [ ] تشغيل smoke test بعد deployment.
- [ ] التأكد أن secrets غير موجودة في Git history.

## B. GameVortex AI

### Chat
- [ ] إضافة `OPENAI_API_KEY` في Vercel فقط.
- [ ] تحديد موديل API حقيقي متاح للحساب.
- [ ] اختبار chat request.
- [ ] اختبار conversation persistence.
- [ ] اختبار idempotency.
- [ ] اختبار rate limiting.
- [ ] اختبار tool access.

### Images
- [ ] إضافة `FAL_KEY`.
- [ ] التأكد من model availability.
- [ ] اختبار image generation.
- [ ] اختبار provider failure ثم التأكد أن credit reservation لا يبقى معلّقًا.
- [ ] تحديد سياسة تخزين/حذف الصور.

### Video
- [ ] إضافة `MINIMAX_API_KEY`.
- [ ] ضبط base URL الصحيح للحساب.
- [ ] اختبار create job.
- [ ] اختبار status polling/callback.
- [ ] اختبار failed job وcredit release.
- [ ] تحديد سياسة تخزين الفيديوهات.

### Owner
- [ ] التأكد أن حساب المالك في DB يحمل `SUPER_ADMIN`.
- [ ] إرسال Chat بعد تفعيل OpenAI والتأكد أن `AiUsage` يسجل الاستخدام بدون خصم credits.
- [ ] إرسال Image والتأكد من عدم خصم credits.
- [ ] إنشاء Video والتأكد من عدم خصم credits.
- [ ] اختبار أن USER/STAFF لا يحصلان على Owner entitlement.

## C. Payments / VIP

- [ ] Stripe sandbox test.
- [ ] Stripe webhook signature verification.
- [ ] VIP purchase end-to-end.
- [ ] Duplicate webhook test.
- [ ] Refund test.
- [ ] Expiration test.
- [ ] Renewal test.
- [ ] Upgrade/extension test.
- [ ] Payment reconciliation.

## D. Wallet / Withdrawals

- [ ] تحديد payout provider.
- [ ] إضافة credentials إلى Vercel.
- [ ] اختبار reservation.
- [ ] اختبار success.
- [ ] اختبار provider failure.
- [ ] اختبار retry/idempotency.
- [ ] اختبار reconciliation.

## E. External Gaming Integrations

- [ ] Steam credentials/OAuth إذا تم تفعيل Steam import.
- [ ] RAWG API key.
- [ ] Xbox provider credentials إذا تم اعتماده.
- [ ] PlayStation provider credentials إذا تم اعتماده.
- [ ] Nintendo provider credentials إذا تم اعتماده.
- [ ] Deal provider حقيقي قبل تشغيل Deal Radar.

## F. Quran

- [ ] Production credentials.
- [ ] Provider availability test.
- [ ] Reciter source/license verification.
- [ ] Audio URL health check.
- [ ] Failure fallback.

## G. Social / Alerts

- [ ] Email provider + verified sender domain.
- [ ] Push notification provider.
- [ ] Release date data source.
- [ ] Price data source.
- [ ] Alert deduplication test.
- [ ] Privacy/retention review.

## H. Security / Accessibility / Performance

- [ ] OWASP-style API review.
- [ ] IDOR test لكل user-owned resource.
- [ ] Prompt injection red-team.
- [ ] Tool injection red-team.
- [ ] XSS test reviews/comments/profile fields.
- [ ] CSRF test mutation endpoints.
- [ ] Session rotation/revocation test.
- [ ] Keyboard-only test.
- [ ] Screen-reader test.
- [ ] Reduced-motion test.
- [ ] Mobile real-device test.
- [ ] Tablet real-device test.
- [ ] Core Web Vitals test.

## I. Legal / Operational

- [ ] Terms of Service review.
- [ ] Privacy Policy review.
- [ ] Game/app source licensing review.
- [ ] Gift-card provider terms review.
- [ ] AI provider terms review.
- [ ] Refund policy review.
- [ ] Data retention policy review.
- [ ] Account deletion policy review.
