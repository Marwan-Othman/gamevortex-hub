# المرحلة 3 — تدقيق قاعدة البيانات و Prisma

## نطاق الفحص
- `prisma/schema.prisma` بالكامل (نحو 100 نموذج وenum)، ومجلد `prisma/migrations` (نحو 60 migration)
- الاستعلامات الخام `$queryRaw` / `$executeRaw` في `lib/trading/*`، `app/api/payments/webhook`، `app/api/me/orders/*`، `app/api/wallet/deposit`
- المعاملات `$transaction` وأقفال `FOR UPDATE` وdrift الجداول
- النماذج المطلوبة: User، VipPlan، VipSubscription، AiUsage، Wallet، OwnerWallet، OwnerLedger، Marketplace (Order/Payment/DigitalKey)، Games

ملاحظة صريحة: تم فحص المسارات الحساسة بعمق، لا كل الملفات الـ167 التي تستخدم Prisma سطراً سطراً.

## ما تم إصلاحه

### 1. جداول تداول موجودة في الـ migrations لكنها غائبة عن schema.prisma
`TradingApproval` و`TradingLiveOrder` منشأتان عبر migrations ويُستخدمان بـ SQL مباشر، لكن لم يكن لهما نموذج في schema. هذا يسبب drift: `prisma migrate dev` قد يقترح `DROP TABLE`.
- أُضيف النموذجان مع `@@ignore` حتى لا يظهران في الـ client (وهو المقصود حسب تعليقات الـ migrations) مع بقائهما معروفين لـ migrate.

### 2. فهارس مفقودة على مسارات قراءة ساخنة
- `Game(published, featured)`: الواجهة الرئيسية وقوائم المتجر.
- `WithdrawalRequest(ownerWalletId, status, createdAt)`: سجل السحب لكل محفظة.
- `OwnerLedger(walletId, createdAt)` و`OwnerLedger(withdrawalId)`: كشف حساب المحفظة والبحث عن السحب.
- الملف: `prisma/migrations/20261008150000_phase3_db_indexes/migration.sql` (إضافي فقط، لا يغيّر بيانات).

### 3. سباق (race condition) في تسليم مفاتيح الألعاب
في `wallet-checkout` و`payments/webhook` كان الكود يقرأ المفاتيح المتاحة ثم يحدّثها. طلبان متزامنان لنفس المنتج كانا يختاران نفس المفاتيح، فيفشل أحدهما بـ `DIGITAL_KEY_ALREADY_CLAIMED` بعد الاستنفاد.
- الإصلاح: `SELECT ... FOR UPDATE SKIP LOCKED` لاختيار مفاتيح غير مقفلة فقط، فيأخذ كل طلب مفاتيح مختلفة بدل الفشل.

### 4. استعلامات N+1 في فتح الإنجازات (`lib/gamer.ts`)
كان كل إنجاز يُفحص بـ `findUnique` منفصل. صار استعلام واحد لكل الإنجازات المفتوحة مسبقاً.

## ما تم التحقق منه وهو سليم
- قفل الصفوف في webhook الإيداع (`WalletDeposit` ثم `Wallet`) قبل قراءة الرصيد: صحيح.
- قفل `Wallet` و`OwnerWallet` و`TradingAccount` في مسارات الدفع والاسترداد والتسوية: صحيح.
- معاملات `Serializable` في VIP وتعديل النقاط: صحيحة.
- الحقول المعرّفة للـ idempotency (`idempotencyKey` في Ledger/Deposit/Order/Claim) كلها `@unique`.
- لا يوجد استيراد لـ Prisma داخل أي مكوّن `"use client"`.
- لا توجد علاقات تحذف بيانات مالية بصمت: `Order.user`، `Entitlement`، `Payment`، `DigitalKey` كلها `Restrict`.

## توصيات لم تُنفّذ (تحتاج قرارك)
1. **منع اشتراكين VIP نشطين للمستخدم نفسه على مستوى قاعدة البيانات**: حالياً الحماية في الكود فقط (Serializable + فحص). فهرس unique جزئي على `status = 'ACTIVE'` قد يكسر منطق التجديد لأن الاشتراك القديم يبقى ACTIVE أثناء إنشاء الجديد. يحتاج تصميم تدفق التجديد أولاً.
2. **حقول نصية يجب أن تكون enum**: `GameVortexAiMessage.role`، `WallpaperReport.status`، `TradingApproval.status`، `TradingLiveOrder.status`. تحويلها يتطلب تعديل الكود والـ migrations.
3. **`VipSubscription.paymentId` مكرر** مع `VipPurchase.subscriptionId`. يُفضّل توحيد مصدر الحقيقة.
4. **`TradingAllocation.amountUsd` من نوع `Int`** بينما `TradingLedger.amountUsd` من نوع `Decimal`. قد يسبب فقدان كسور الدولار.
5. **`OwnerLedger.withdrawalId` بلا علاقة FK**. إضافة FK تحتاج التحقق من البيانات الموجودة أولاً.
6. **`points.ts` و`vip-subscriptions.ts`** تستخدم `Serializable` دون إعادة المحاولة عند `P2034`. قد تفشل معاملة بشكل مشروع بدل إعادة تنفيذها.
7. **`Game` ← `GameProduct` Cascade** بينما `OrderItem` و`DigitalKey` مرتبطان بـ `Restrict`: حذف لعبة لها طلبات يفشل بخطأ قاعدة بيانات، وهذا سلوك آمن لكن الرسالة غير واضحة للمشرف.
8. **فهرس partial** `TradingApproval_executionSnapshot_idx` غير ممثّل في schema. Prisma قد يقترح حذفه في `migrate diff`؛ تجاهله آمن إن لم يظهر في الفرق.

## تحقق يجب تشغيله محلياً (لم أستطع تشغيله هنا: لا توجد node_modules ولا اتصال بالشبكة)
```bash
npm ci
npx prisma validate
npx prisma format --check
npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --script
npx prisma migrate deploy   # على نسخة staging أولاً
npx prisma generate
npx tsc --noEmit
```
إذا أظهر `migrate diff` فرقاً متعلقاً بـ `TradingApproval` أو `TradingLiveOrder` (مثل إسقاط FK)، أضف علاقة `User` إليهما وتحقق مرة أخرى.

## تحقق تم فعلياً هنا
- الملفات الثلاثة المعدّلة في الكود (`wallet-checkout/route.ts`، `payments/webhook/route.ts`، `lib/gamer.ts`) تمر فحص الصياغة (لا أخطاء TS1xxx).
- عدد أقواس `schema.prisma` متوازن، ولا توجد نماذج مكررة.

---

## تحديث V5 (تصليحات خفيفة)
- لا تغيير على `schema.prisma` ولا migrations في هذه الجولة (لا يوجد سبب تقني واضح).
- إعادة فحص: لا استيراد لـ Prisma داخل أي ملف `"use client"`.
- الاستعلام عن حساب المالك في مسارات الدفع صار ثابتاً ومحدداً (`orderBy createdAt asc` عند الاحتياط) عبر `lib/owner-account.ts`.
- ما زالت التوصيات المؤجلة أعلاه (partial unique للـ VIP، تحويل الحقول النصية إلى enum، FK لـ `OwnerLedger.withdrawalId`، إعادة المحاولة عند `P2034`) تحتاج قرارك.
