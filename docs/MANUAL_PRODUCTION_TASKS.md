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

- [ ] Set server-only `GEMINI_API_KEY` and `MANUS_API_KEY`. Both are required by production env validation. Chat uses Gemini with Manus failover.
- [ ] Optional chat controls: `GEMINI_MAX_OUTPUT_TOKENS` (default 2048) and `GEMINI_THINKING_LEVEL` (default `low`).
- [ ] Do not set retired variables `GAMEVORTEX_AI_RUNTIME_URL`, `GAMEVORTEX_AI_RUNTIME_TOKEN`, or `GAMEVORTEX_AI_MODEL`. Environment validation rejects them.
- [ ] Image and video routes call Gemini when `GEMINI_API_KEY` is set. The old `AiMediaJob` persistence tables were removed and are not the current storage path.
- [ ] Verify Arabic/English chat, cancellation, credit refunds on failure, and that one user cannot open another user's conversation.

## C. تسجيل الدخول الاجتماعي

- [ ] Google: إنشاء Web OAuth Client وضبط `GOOGLE_CLIENT_ID` و`GOOGLE_CLIENT_SECRET` وCallback URL: `/api/auth/oauth/google/callback`.
- [ ] Apple: إعداد Sign in with Apple وServices ID وPrivate Key في Apple Developer، ثم ضبط `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` وCallback URL: `/api/auth/oauth/apple/callback`.
- [ ] Steam: لا يحتاج زر الدخول لمفتاح API؛ سجّل callback/domain الصحيح واختبر تحقق OpenID وإعادة التوجيه على HTTPS.
- [ ] PlayStation: لا تفعّل زرًا وهميًا ولا تستخدم واجهات Sony غير الموثقة أو تطلب كلمة مرور PSN. يلزم وصول/اعتماد مطوّر رسمي من Sony قبل تنفيذ التكامل.


## D. Payments / VIP

- [ ] Stripe sandbox test.
- [ ] Stripe webhook signature verification.
- [ ] VIP purchase end-to-end.
- [ ] Duplicate webhook test.
- [ ] Refund test.
- [ ] Expiration test.
- [ ] Renewal test.
- [ ] Upgrade/extension test.
- [ ] Payment reconciliation.

## E. Wallet / Withdrawals

- [ ] تحديد payout provider.
- [ ] إضافة credentials إلى Vercel.
- [ ] اختبار reservation.
- [ ] اختبار success.
- [ ] اختبار provider failure.
- [ ] اختبار retry/idempotency.
- [ ] اختبار reconciliation.

## F. External Gaming Integrations

- [ ] Steam credentials/OAuth إذا تم تفعيل Steam import.
- [ ] RAWG API key.
- [ ] Xbox provider credentials إذا تم اعتماده.
- [ ] PlayStation provider credentials إذا تم اعتماده.
- [ ] Nintendo provider credentials إذا تم اعتماده.
- [ ] Deal provider حقيقي قبل تشغيل Deal Radar.

## G. Quran

- [ ] Production credentials.
- [ ] Provider availability test.
- [ ] Reciter source/license verification.
- [ ] Audio URL health check.
- [ ] Failure fallback.

## H. Social / Alerts

- [ ] Email provider + verified sender domain.
- [ ] Push notification provider.
- [ ] Release date data source.
- [ ] Price data source.
- [ ] Alert deduplication test.
- [ ] Privacy/retention review.

## I. Security / Accessibility / Performance

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
- [ ] Review the self-hosted model license and data-retention policy.
- [ ] Refund policy review.
- [ ] Data retention policy review.
- [ ] Account deletion policy review.
