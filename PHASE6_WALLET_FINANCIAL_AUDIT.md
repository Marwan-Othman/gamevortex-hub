# المرحلة 6 — Wallet + Financial System

## نطاق الفحص
Wallet، OwnerWallet، OwnerLedger، WalletTransaction، Payments، Purchases، Withdrawals، Points، رصيد AI، وإدخال السحوبات (Draws).

## ما كان سليماً أصلاً
- `FOR UPDATE` على المحفظة في الإيداع والشراء والاسترداد، ومفاتيح idempotency فريدة في كل دفتر.
- شراء المحفظة وتسليم المفاتيح وإيراد المالك في transaction واحدة (فشل أي جزء يلغي الكل).
- VIP يعمل بـ Serializable ويتحقق من المبلغ والعملة.

## المشاكل التي أُصلحت
| # | الملف | المشكلة | الإصلاح |
|---|-------|---------|---------|
| 1 | `lib/points.ts` | إعادة استخدام مفتاح بمبلغ مختلف تُرجع القيد القديم؛ `adjustPoints` قراءة ثم كتابة؛ لا إعادة محاولة عند P2034 | مسار موحّد: تحديث شرطي ذرّي، رفض `IDEMPOTENCY_KEY_CONFLICT`، إعادة محاولة |
| 2 | webhook (Stripe) | الاسترداد الجزئي يُقرأ كاملاً (مبلغ الشحنة بدل `amount_refunded`) | استخدام `amount_refunded` |
| 3 | webhook (إيداع) | نجاح متأخر بعد FAILED يرمي خطأ للأبد (مال وصل ولم يُضف) | يُضاف الرصيد دائماً ويُسجَّل `depositStatusBefore` |
| 4 | webhook (إيداع) | حدث FAILED متأخر يقلب COMPLETED/REFUNDED إلى FAILED | FAILED يُطبَّق على PENDING فقط |
| 5 | webhook (إيداع) | تحرير `pendingBalance` بلا حد أدنى | تحرير مقيّد بما هو موجود فعلاً |
| 6 | webhook (متجر) | لا قفل على الطلب؛ دفعة بطاقة لطلب مدفوع بالمحفظة تُسلّم المفاتيح وتُسجّل الإيراد مرتين | `FOR UPDATE` على الطلب + رفض الدفعة الزائدة وتسجيلها في AuditLog (`MANUAL_REFUND_REQUIRED`) |
| 7 | webhook (إيراد) | طلب بعملة غير USD يُضاف لرصيد USD | لا يُضاف؛ يُسجَّل في الدفتر بـ `usdAmount = null` |
| 8 | `wallet/deposit` | مفتاح مكرر بمبلغ مختلف؛ إيداع عالق بلا دفعة؛ rollback يكتب فوق COMPLETED؛ تسريب حقول داخلية | فحص المبلغ، استئناف الإيداع، rollback مقفول وشرطي، إخراج عام فقط |
| 9 | `wallet-checkout` | الطلب غير مقفول؛ فحص الرصيد قبل idempotency؛ خصم غير شرطي؛ تسريب أخطاء DB | قفل الطلب، ترتيب صحيح، `updateMany` شرطي، أخطاء معقّمة |
| 10 | `wallet-refund` | الطلب غير مقفول؛ تسريب أخطاء | قفل الطلب، أخطاء معقّمة |
| 11 | `checkout` (بطاقة) | بعد استدعاء المزوّد قد يُرجِع طلباً/دفعة مدفوعة إلى حالة معلّقة | قفل الطلب، ولا تراجع عن SUCCEEDED/REFUNDED |
| 12 | `scripts/process-withdrawals.mjs` | دفع مزدوج عند تشغيلين؛ إرجاع النقاط رغم أن المال أُرسل؛ تسجيل النقاط مرتين بالدفتر | claim شرطي، إرجاع النقاط عند رفض قاطع (4xx) فقط، مفاتيح موحّدة مع مسار الإدارة، حالات غامضة تبقى PROCESSING |
| 13 | `lib/ai/credits.ts` | سباق يُنزل الرصيد تحت الصفر؛ فشل الاسترداد صامت | خصم شرطي ذرّي، معالجة P2002، تسجيل فشل الاسترداد في SystemError |
| 14 | `draws/[id]/enter` | بيع تذاكر فوق السعة؛ مفتاح بعدد تذاكر مختلف | قفل الـ Raffle وفحص عدد التذاكر |
| 15 | `owner-wallet/reconcile` | تسريب أخطاء DB وسباق على المفتاح | 409 للسباق وأخطاء معقّمة |

## قرارات مقصودة (لم تُغيَّر)
- **رصيد سالب مسموح بحالتين فقط:** عكس نقاط شراء صرفها المستخدم، واسترداد مزوّد لإيداع صُرف. كلاهما يُسجَّل بالدفتر (والثاني بعلامة `resultedInNegativeBalance`)، وكل مسارات الصرف تشترط `balance >= amount`.
- لذلك لا يوجد CHECK على `Wallet.balance` ولا `User.points`.

## ملاحظات مفتوحة
- إيراد VIP لا يُسجَّل في `OwnerLedger` (بعكس المتجر وAPI access). يحتاج قرارك المحاسبي.
- استرداد دفعة زائدة (بند 6) يدوي حالياً.

## Migration
`20261009120000_phase6_financial_guards`: قيود CHECK بصيغة `NOT VALID` (تُطبَّق على الكتابات الجديدة فقط) على `Wallet.pendingBalance` و`OwnerWallet` (نقاط) و`AiCreditBalance.gvcBalance`. نفّذ `VALIDATE CONSTRAINT` بعد مراجعة البيانات القديمة.

## الاختبارات
`tests/points-standalone.test.ts` جديد. لم تُشغَّل في بيئة الفحص (لا node_modules)؛ شغّل `npm test` و`npx tsc --noEmit` عندك.
