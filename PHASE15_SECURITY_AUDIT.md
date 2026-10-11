# المرحلة 15 — Security Audit

نطاق الفحص: كامل المشروع (الكود، `.env.example`، `.env.production.example`، `.gitignore`، `.dockerignore`، Docker/compose، GitHub Actions، السكربتات، الـ API). لم تُطبع أي قيمة سرّ في هذا التقرير ولا في سجلات الفحص.

## الملخص
| الخطورة | وُجد | أُصلح |
|---|---|---|
| عالية | 3 | 3 |
| متوسطة | 6 | 6 |
| منخفضة | 6 | 6 |
| ملاحظات/مخاطر متبقية | 8 | موثّقة أدناه |

## 1) الأسرار (Secrets / API keys / .env / .gitignore)
- **لا توجد أسرار حقيقية** في أي ملف (بحث بأنماط AWS/Google/Stripe/GitHub/Slack/Blob/Resend/مفاتيح خاصة/روابط DB بكلمة مرور): النتائج فقط قيم محلية/CI وهمية (`gamevortex_password`, `ci:ci`).
- لا يوجد ملف `.env` حقيقي ولا مفاتيح خاصة في الأرشيف. `.gitignore` يستثني `.env*` ويُبقي الأمثلة. أُضيف: `*.pem *.key *.p8 *.pfx *.p12 id_rsa* .npmrc service-account*.json`. `.dockerignore` أُضيفت له نفس القواعد.
- لا `NEXT_PUBLIC_*` يحمل سرًّا (المستخدم فقط `NEXT_PUBLIC_SITE_URL`)، ولا يستخدم أي ملف client متغير بيئة سرّيًّا. `validate-env` كان يمنع ذلك أصلًا؛ أضفت اختبارًا آليًا.
- **[عالية — أُصلحت] قيمة AUTH_SECRET الوهمية تجتاز التحقق.** `replace-with-at-least-32-random-characters` (42 حرفًا) في `.env.example` و`REPLACE_WITH_64_PLUS_RANDOM_CHARACTERS` في ملف الإنتاج تجتاز فحص الطول (≥32)؛ من ينسخ المثال كما هو يصبح سرّ التوقيع **معروفًا للعامة** → تزوير كوكي الجلسة لأي مستخدم بما فيهم المالك. الإصلاح: `lib/secret-strength.ts` (يرفض placeholder/قصير/منخفض التنوّع) مطبّق في `lib/auth.ts` و`lib/ai/media-token.ts` (في production يُرفض التوقيع) وفي `scripts/validate-env.mjs` لـ `AUTH_SECRET/CRON_SECRET/DIGITAL_KEY_ENCRYPTION_SECRET/PAYMENT_WEBHOOK_SECRET/POSTGRES_PASSWORD`.
- `docker-compose.yml` (تطوير) كان ينشر Postgres على كل الواجهات بكلمة مرور افتراضية → ربطته بـ `127.0.0.1`. `docker-compose.prod.yml` سليم (يفرض `POSTGRES_PASSWORD` ولا ينشر المنفذ).
- بيانات شخصية: بريد المالك الحقيقي كان مكتوبًا في رسالة خطأ `scripts/fix-owner-conflict.mjs` → أُزيل.
- **سجل Git لم يُفحص**: الأرشيف بلا `.git`. شغّل محليًا: `gitleaks detect --log-opts="--all"` (أو `trufflehog git file://.`). أي سرّ وُجد يُعتبر مسرَّبًا ويُدوَّر.

## 2) الثغرات
| الفئة | النتيجة | الحالة |
|---|---|---|
| SQL injection | كل `$queryRaw` (13 موضعًا) يستخدم `Prisma.sql` بمعاملات؛ لا `*Unsafe` ولا `Prisma.raw`. بقية الوصول عبر Prisma Client | ✅ سليم (+اختبار آلي) |
| XSS | لا `dangerouslySetInnerHTML/innerHTML/eval/new Function`. روابط المحتوى تمر بـ `safeHttpUrl/normalizeExternalSourceUrl` (https فقط). **روابط avatar/banner في الملف الشخصي كانت تقبل أي نص** (أُصلحت في المرحلة 14: https فقط). CSP موجودة لكن `script-src 'unsafe-inline'` (انظر المتبقي) | ✅ / ⚠️ CSP |
| CSRF | كل mutation يمر بـ `guardMutation` (Origin + Sec-Fetch-Site + حد معدّل) والكوكي `SameSite=Lax`؛ الويب هوك بتوقيع، الـ cron بسرّ. OAuth: `state` + `nonce` | ✅ |
| SSRF | مستورد الخلفيات يفحص DNS/IP الخاص ويتتبّع التحويلات يدويًا (ممتاز). **ثغرة**: بروكسي التنزيل/العرض للخلفيات كان يجلب أي رابط https مخزّن (بما فيه عناوين داخلية) مع `redirect: follow` | 🔧 أُصلح: بوابة `normalizeExternalSourceUrl` (ترفض localhost/IP خاص/metadata) + مهلة |
| Path traversal | كل المسارات المحلية تُحل داخل `public/wallpapers` وتُرفض `..` و`\0`؛ مسارات Blob تُتحقق (`isValidBlobPathname`، `isValidWallpaperPath`) | ✅ |
| Arbitrary file upload | رفع Blob بتوكن من السيرفر: SUPER_ADMIN فقط، امتدادات/أنواع محددة، حجم أقصى، فحص التوقيع (magic bytes) لـ APK/الصور، **SVG غير مسموح**. أُضيف `Content-Security-Policy: sandbox` ورأس `CORP` عند تقديم الوسائط من نطاقنا | ✅ + 🔧 تحصين |
| Broken authorization / IDOR | فُحصت كل مسارات `[id]`: الطلبات/المفاتيح/التذاكر/المحادثات/الإيداعات تُقيَّد بـ `userId` في الاستعلام نفسه؛ مسارات المالك `requireOwner` بدور مقروء من DB كل طلب | ✅ |
| Privilege escalation | `SUPER_ADMIN` فقط للبريد المُعدّ `OWNER_EMAIL` وبمالك واحد. **[عالية — أُصلحت]** `scripts/seed-production.mjs` كان يرقّي أي حساب موجود بنفس `OWNER_EMAIL` إلى SUPER_ADMIN، والتسجيل **لا يتحقق من ملكية البريد** → مهاجم يسجّل ببريد المالك قبل أول bootstrap فيحصل على المالك بكلمة مروره. الآن عند ترقية حساب موجود تُستبدل كلمة المرور بـ `OWNER_INITIAL_PASSWORD` وتُحذف حسابات OAuth المرتبطة. + تحذير في `fix-owner-conflict`. تغيير الدور يرفع `sessionVersion` | 🔧 |
| الجلسات / الكوكيز | `httpOnly`, `SameSite=Lax`, `Secure` في production، توقيع HMAC-SHA256 بمقارنة ثابتة الزمن، انتهاء 7 أيام. **[عالية — أُصلحت]** تسجيل الخروج كان يحذف الكوكي في المتصفح فقط (`sessionVersion` لا يُرفع في أي مكان) فيبقى الكوكي المسروق صالحًا 7 أيام → الآن `POST /api/auth/logout` يبطل كل الجلسات (`revokeSessions`) | 🔧 |
| Token confusion | رمز وسائط AI وكوكي الجلسة يوقَّعان بنفس السرّ بلا فصل → أُضيف فصل نطاق (`gv-media-token:`) لرمز الوسائط (رموز الفيديو الجارية تنتهي مرة واحدة عند النشر) | 🔧 |
| Rate-limit bypass | تزوير `X-Forwarded-For` في النشر الذاتي (أُصلح في المرحلة 14: `TRUSTED_PROXY_HOPS`)؛ حد لكل حساب لتسجيل الدخول؛ حدود لكل IP لمفاتيح API الخاطئة | 🔧 / ⚠️ انظر المتبقي |
| Unsafe redirects | `next` في تسجيل الدخول نسبي فقط (يمنع `//` و`\`)؛ `NextResponse.redirect` للتنزيل يستخدم رابطًا مُتحققًا منه؛ OAuth redirect URI من `APP_ORIGIN`. وُجد رابط `/login?next=` غير صحيح (404) في المفضلة → صُحّح إلى `/auth/login` | ✅ + 🔧 |
| OAuth | `state` الآن بمقارنة ثابتة الزمن؛ التحقق من JWT (توقيع RS256، iss، aud، exp، iat، nonce)؛ الربط بالبريد فقط عند `email_verified` | ✅ |
| رسائل خطأ حسّاسة / تسريب DB | أُغلقت في المرحلة 14 (`publicErrorCode`، 60 route) + اختبار آلي. الآن أيضًا: **تنقيح الأسرار من السجلات وجدول SystemError** | ✅ |
| سجلات تحتوي أسرارًا | جديد `lib/redact.ts`: يزيل روابط DB وBearer وJWT وهاش scrypt ومفاتيح gvh_live/Stripe/Google/GitHub/Slack/Blob/Resend والمفاتيح الخاصة وأزواج `password=…` — مطبّق على `logEvent`، `logSystemError` (الرسالة والـ metadata)، وسجل الأخطاء المقنّعة. `logSafe` يمنع حقن سطور سجل من `pathname` المُدخل (وُجد في رفع الخلفيات) | 🔧 |

## الملفات الجديدة/المعدّلة
- جديد: `lib/secret-strength.ts`، `lib/redact.ts`، `tests/security-audit.test.ts` (يفحص آليًا: لا أسرار، لا NEXT_PUBLIC سرّي، `.gitignore`، أمثلة env، لا XSS sinks، كل SQL خام بـ `Prisma.sql`، وحدات الدوال الجديدة).
- معدّل: `lib/auth.ts`، `lib/ai/media-token.ts`، `lib/auth/oauth.ts`، `lib/observability.ts`، `lib/api.ts`، `lib/wallpaper-delivery.ts`، `app/api/auth/logout`، `app/api/admin/owner-control`، `app/api/wallpapers/[id]/{media,download}`، `app/api/admin/wallpapers/upload`، `scripts/{validate-env,seed-production,fix-owner-conflict}.mjs`، `docker-compose.yml`، `.gitignore`، `.dockerignore`، `app/wallpapers/*` (روابط تسجيل الدخول).

## المخاطر المتبقية / يحتاج منك
1. **لم أشغّل `tsc` ولا `vitest` ولا `next build`** (لا شبكة لتثبيت الحزم): فُحصت الصياغة (0 أخطاء) وكررت منطق الاختبارات الجديدة يدويًا. شغّل `npm ci && npm run typecheck && npm test`.
2. **نشر موجود**: بعد النشر ستنتهي جلسات الجميع عند أول logout فقط؛ أما رموز الفيديو الجارية فتفشل مرة واحدة. تأكد أن `AUTH_SECRET` الحالي في الإنتاج عشوائي حقًا (وإلا سيرفض التطبيق التوقيع ويطلب سرًّا جديدًا — وهذا مقصود). إن كان قد استُخدم قيمة المثال يومًا فاعتبر كل الجلسات مخترقة ودوّره.
3. **سجل Git** لم يُفحص (انظر أعلاه). دوّر أي سرّ سبق أن ظهر في أي commit/لقطة شاشة/محادثة.
4. **CSP**: `script-src 'unsafe-inline'` و`connect-src https:` يضعفان الحماية من XSS (لا يوجد XSS sink حاليًا). الحل الكامل nonce عبر middleware — يحتاج اختبار مع Next؛ لم أغيّره لتجنب كسر الواجهة.
5. **تسجيل بلا تحقق من البريد**: مهاجم يستطيع حجز بريد شخص قبل تسجيله (pre-hijack) على مستوى المستخدمين العاديين. المالك مغطّى بالإصلاح أعلاه؛ يُنصح بإضافة تحقق بريدي.
6. **Rate limit** افتراضيًا في ذاكرة كل instance؛ مع أكثر من نسخة/Serverless استخدم `RATE_LIMIT_STORE=upstash`. وإن كنت خلف Docker/nginx اضبط `TRUSTED_PROXY_HOPS`.
7. `scryptSync` يحجب حلقة الأحداث أثناء تسجيل الدخول (محمي بحد 8/دقيقة/IP و10/15د لكل حساب)؛ للحمل العالي انقل إلى `crypto.scrypt` غير المتزامن.
8. `console.error(…, error)` في بعض المسارات يطبع كائن الخطأ كاملًا (قد يتضمن وسائط استعلام Prisma). المسارات الجديدة تمر بالتنقيح؛ الأقدم تحتاج مراجعة بحسب منصة السجلات. وفي مستورد الخلفيات يبقى TOCTOU نظريًا لـ DNS rebinding (للمالك فقط).
9. GitHub Actions تستخدم وسوم (`@v4`) لا SHA مثبّتة — يُفضّل تثبيتها.
