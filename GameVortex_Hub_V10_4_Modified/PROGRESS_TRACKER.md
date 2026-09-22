# GameVortex Hub — Master Task Plan — Progress Tracker

هذا الملف هو المرجع الوحيد لحالة تنفيذ خطة المهام (GameVortex_Hub_Master_Task_Plan.md).
يُحدَّث بعد كل دفعة عمل. لا تحذف هذا الملف — هو ذاكرة المشروع بين الجلسات.

آخر تحديث: 2026-09-22
الدفعة الحالية: **دفعة 0 — الفحص الأولي (Audit)**
حجم الدفعة المتفق عليه: 25 مهمة لكل دفعة.

---

## حالة عامة

| القسم | عدد المهام | الحالة |
|---|---|---|
| 1. GameVortex AI | ~35 | ⬜ لم يبدأ التنفيذ (فحص أولي فقط) |
| 2. AI Trading (Owner Edition) | ~142 | ⬜ لم يبدأ (يتطلب أقصى حذر — أموال حقيقية) |
| 3. Current Site Tasks (API/نقاط/أرباح) | 14 | ⬜ لم يبدأ التنفيذ |
| 4. Wallet Top-Up System | 47 | ⬜ لم يبدأ (يوجد أساس جزئي — انظر الملاحظات) |
| 5. UI/UX Master Redesign | 61 | ⬜ لم يبدأ |
| Owner Full Control Center (بند 62) | 1 | ⬜ لم يبدأ |

---

## دفعة 0 — نتائج الفحص الأولي (لا تعديل كود، فحص فقط)

### التقنيات الأساسية
- Next.js 16.3.1، React 19.1.8، Prisma 6.12.0، TypeScript 5.8.3، Zod 4.0.0، Vitest للاختبارات.
- **ملاحظة مهمة:** لا يوجد SDK رسمي لـ OpenAI/Stripe/PayPal ضمن dependencies — يبدو أن الاتصال يتم عبر `fetch` مباشر (`lib/ai/openai.ts`, `lib/ai.ts`). يحتاج تأكيد عند الدخول لتفاصيل كل ملف.

### AI System (القسم 1)
- موجود فعليًا: `app/ai/AIChat.tsx`, `app/api/ai/*`, `lib/ai.ts`, `lib/ai/openai.ts`.
- موجود بقاعدة البيانات: `AiUsage`, `Conversation`, `Message` (يعني نظام محادثات دائم مبدئي موجود مسبقًا — ليس من الصفر).
- **غير موجود بعد (حسب الفحص الأولي):** Engineering Agent, Multi-Agent System, fal.ai integration, MiniMax integration, AI Router, Sandbox/Workspace, Human Approval UI. يحتاج فحص أعمق لكل ملف قبل الجزم 100%.

### Wallet / نقاط / أرباح المالك (الأقسام 3 و 4)
- موجود بقاعدة البيانات: `Wallet`, `OwnerWallet`, `OwnerLedger`, `PointLedger`, `WithdrawalRequest`, `Payment`, `Order`, `AuditLog`.
- موجود API: `app/api/owner/withdraw/route.ts`, `app/api/payments/webhook/route.ts`.
- متغيرات بيئة جاهزة مسبقًا في `.env.example`: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PAYPAL_CLIENT_ID/SECRET`, `PAYMENT_PROVIDER`, `PAYMENT_WEBHOOK_SECRET`, `OWNER_POINTS_PER_USD`, `OWNER_MIN_WITHDRAW_POINTS`.
- **الخلاصة:** الأساس المالي والمحفظي **موجود مسبقًا وأكثر نضجًا مما توقعنا** — الخطة (القسم 4) تقول "لا تنشئ Wallet جديدة إذا الحالية قابلة للتطوير"، وهذا ينطبق هنا. الشغل الحقيقي هو **تطوير وربط الموجود**، مو بناء من الصفر.

### VIP / Rewards
- موجود بقاعدة البيانات: `VipPlan`, `VipSubscription`, `VipSubscriptionEvent`, `VipReward`, `VipRewardClaim`, `VipPurchase`. نظام VIP يبدو مبني بشكل جيد ومفصل مسبقًا.

### AI Trading (القسم 2)
- **لا يوجد أي أثر له بالكود الحالي إطلاقًا** (لا نماذج DB، لا API). هذا القسم كامل بناء جديد بالكامل فوق مشروع قائم — الأخطر ماليًا وشرعيًا، ويحتاج أطول وقت اختبار (Paper Mode أولاً حسب قواعدك أنت بالخطة).

---

## دفعة 1 — القسم 3 (Current Site Tasks) — نتائج فعلية

**تم تنفيذها بالكامل (كود حقيقي، إضافي، صفر تعديل على منطق موجود):**
- ✅ بند 6 — نظام قيمة النقاط: `lib/points-economy.ts` (جديد). Owner 30=$1 (نفس القيمة القديمة بدون تغيير)، VIP 500=$1، User 1000=$1. قابلة للتعديل عبر Environment Variables.
- ✅ بند 7 — الحد الأدنى للسحب: نفس الملف. Owner $0.50 (بدون تغيير)، VIP $5، User $10.
- ✅ بند 5 — نقاط المنتجات: دالة جديدة `awardBuyerPoints()` داخل `app/api/payments/webhook/route.ts` — تُضيف نقاط للمشتري (10 نقطة إذا مجاني، أو نقاط متناسبة مع السعر إذا مدفوع)، بدون أي لمس لدالة `rewardOwnerPoints()` الموجودة (نقاط المالك تبقى كما هي بالضبط). تعمل داخل نفس الـ DB Transaction الأصلي (ذرية كاملة).
- ✅ بند 11 — خصم النقاط عند السحب: endpoint جديد `POST /api/wallet/withdraw` (لـ VIP والمستخدم العادي فقط — المالك له مساره المنفصل الموجود مسبقًا `/api/owner/withdraw`). الخصم يتم عبر `debitPoints()` الموجودة مسبقًا (Serializable transaction، تمنع الرصيد السالب) **قبل** إنشاء سجل السحب.
- ✅ بند 13 و14 — النقاط حقيقية ومفصولة عن محفظة المالك: كانت متحققة أصلاً ببنية قاعدة البيانات الحالية (`PointLedger`/`User.points` منفصلة عن `Wallet` و`OwnerWallet`)، لم تحتج كود إضافي — فقط تأكيد.
- Prisma: موديل جديد `UserWithdrawalRequest` + migration يدوي (`20260922150000_add_user_withdrawal_requests`) — **لسا محتاج تطبيقه فعليًا على قاعدة البيانات** (نفس طريقة أي migration سابق: `npx prisma migrate deploy` أو عبر Vercel Build).

**مُرجّأة لدفعة 2 (تحتاج تصميم/قرارات أوسع قبل الكود):**
- ⬜ بند 1، 2، 3 — نظام API خاص بالموقع + بيعه بـ$10 + مركز تحكم API للمالك: ميزة كاملة جديدة (توليد مفاتيح، صفحة شراء، Webhook دفع، صفحة إدارة) — تحتاج نقاش تصميم قصير قبل الكود (مثلاً: أي بوابة دفع لل$10، شكل صلاحيات الـ API الخارجي).
- ⬜ بند 4، 8 — نظام أرباح المالك الشامل وتعظيمه: يحتاج مراجعة كل نقاط البيع بالموقع (مو ملف واحد)، أنسب كدفعة مستقلة بعد ما نغطي بقية الأقسام.
- ⬜ بند 9 — نظام الحماية والخصوصية الشامل: هذا فعليًا "مراجعة أمنية" عابرة لكل الأقسام، أنسب تنفيذها كخطوة أخيرة بعد كل الدفعات (كما هو موجود بترتيب الخطة الأصلي: Security Audit قبل الإطلاق).
- ⬜ بند 10 — نظام الدعم والتواصل: ميزة مستقلة كاملة (Tickets/Chat) — تحتاج جدول DB جديد + صفحات UI، أنسب كدفعة منفصلة.

**قبل الرفع للـ Production لازم:**
1. تشغيل الـ migration الجديد على قاعدة البيانات الحقيقية (Neon) — إما محليًا أو يتم تلقائيًا عبر Vercel build command إذا كان يشمل `prisma migrate deploy`.
2. اختبار `/api/wallet/withdraw` على Preview قبل `main`.

## الدفعة القادمة (دفعة 2 — مقترحة)
بنود 1-3 (نظام API الموقع وبيعه)، بعد نقاش تصميم قصير أول.
