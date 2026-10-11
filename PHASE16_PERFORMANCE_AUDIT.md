# المرحلة 16 — Performance Audit

التاريخ: 2026-10-10 · الأساس: `GameVortex_Phase15_SecurityAudit`

> **ملاحظة تحقق (مهمة):** بيئة العمل اللي اشتغلت فيها ما بتسمح بالوصول لـ `registry.npmjs.org`، فما قدرت أنصّب
> الـ dependencies ولا أشغّل `tsc` / `vitest` / `next build` بشكل فعلي. اللي تم فعليًا: فحص syntax لكل ملفات TS/TSX (0 أخطاء)،
> و `npm run test:source` ✅ و `npm run test:owner-policy` ✅، وفحص `next.config.mjs` و `sw.js` بـ Node.
> **قبل النشر شغّل عندك:** `npm install && npm run typecheck && npm test && npm run build`
> ثم `npm run db:deploy` لتطبيق migration الفهارس الجديد.
> (`test:env-contract` بيفشل بسبب `POSTGRES_PASSWORD` في `.env*.example` — مشكلة قديمة مش من هالمرحلة.)

---

## 1) Database queries

| # | المشكلة | الإصلاح |
|---|---|---|
| 1 | الصفحة الرئيسية: 6 استعلامات لكل زائر، 4 منها بترجّع صفوف `Game` كاملة (description + screenshots) | `lib/home-data.ts`: `unstable_cache` لمدة 60 ثانية (+ tag `home-catalog`) و `select` للأعمدة المعروضة فقط |
| 2 | `Game` كان عليه فهرس واحد `(published, featured)` بينما الواجهة بترتب بـ `createdAt` / `ratingAverage` / `playCount` / `viewCount` | 4 فهارس مركّبة جديدة + `App(published, createdAt)` + `GameProduct(active, createdAt)` + `GameLibraryItem(userId, updatedAt)` + `GamerProfile(level, xp)` — migration `20261010100000_phase16_performance_indexes` (آمن: `IF NOT EXISTS`، additive فقط) |
| 3 | `/games`: `include` لكل اللعبة + join على كل التصنيفات (غير مستخدم بالعرض) | `select` للأعمدة المعروضة + `gamePlatforms.platform` فقط |
| 4 | `/games/[slug]`: استعلامان ثقيلان (`generateMetadata` + الصفحة) | `React.cache()` → استعلام واحد لكل طلب |
| 5 | `/profile/gamer`: 11 استعلام **ورا بعض** (sequential) | `Promise.all` + `select` لقائمة المكتبة والطلبات |
| 6 | `/rankings`: استعلام لكل زيارة لبيانات عامة | `unstable_cache` 60s + `select` |
| 7 | `/marketplace`: `include: { game: true }` لـ 100 منتج | `select` للأعمدة المعروضة |
| 8 | `/api/me/recommendations`: تحميل حتى 600 صف `Game` كامل لكل طلب | `select` (id/genre/platform للإشارات، حقول البطاقة للمرشحين) + `Cache-Control: private, max-age=60` |

## 2) Server Components vs Client Components

لم يتم تحويل أي مكوّن إلى Client بدون سبب. بالعكس — تم **تقليل** الـ Client:

- `LocaleText` (كان Client وكل نص بالصفحة = "جزيرة" hydration منفصلة، عشرات منها بصفحة `/games`) → **Server Component** يقرأ نفس cookie الـ layout.
- `GameRow`, `HeroCarousel`, `SiteFooter` → **Server Components** (ما فيهم state ولا events).
- `LanguageSwitcher` صار يعمل `router.refresh()` عند تبديل اللغة (وبيزامن الـ cookie مرة وحدة إذا اختلفت لغة الجهاز/التخزين عن اللي رسمه السيرفر) حتى يشتغل التبديل مع الـ Server Components.
- `LocaleProvider` جديد: الـ Client Components بتبدأ بنفس لغة السيرفر (كان الافتراضي `"en"` → وميض إنجليزي + hydration mismatch لمستخدمي العربي).

بقي Client عن قصد: Header/BottomNav (تفاعل/ pathname)، الفورمات، لوحات الإدارة، الاستوديو/الدمج الذكي.

## 3) Re-renders

- `SiteHeader`: حقل البحث كان state في الـ Header نفسه → كل ضغطة مفتاح = إعادة رسم (17 رابط + الدرج + الأيقونات). انتقل لمكوّن `HeaderSearch` (memo) بحالته الخاصة.
- `ApiAccessClient`: الـ polling كل 5 ثواني (أثناء PENDING) بيتوقف إذا التبويب مخفي.

## 4) API calls / Duplicate requests

- `/api/auth/me` كان يُستدعى من `SiteHeader` **مع كل تغيير مسار** (+ مرة ثانية من `AccountNav`). الآن `lib/client-auth.ts`: طلب واحد مشترك، TTL = 30s، ويتم إبطاله (`invalidateMe()`) عند login / register / logout حتى ما تظهر هوية قديمة.
- `/api/wallpapers/[id]/media?thumb=1`: الشبكات (قائمة الخلفيات، المفضلة، المشابهة) بتطلب الـ thumbnail إذا موجود بدل الصورة الأصلية كاملة (fallback تلقائي للأصل).

## 5) Image optimization / Large bundles

- PNG → WebP: `hero-desktop` 466→152KB، `hero-mobile` 448→143KB، `vip-banner` 258→123KB، `ai-banner` 240→109KB، `gamer-profile` **1227→186KB** (المراجع محدّثة).
- صور `design/*-reference.png` (1MB+) مش مستخدمة بالكود → انتقلت من `public/` إلى `docs/design-reference/` (ما عادت تنخدم للعامة).
- `<link rel="preload" as="image">` لخلفية الـ hero (الموبايل/الديسكتوب حسب الـ breakpoint) لتحسين LCP.
- `fetchPriority="high"` لغلاف اللعبة/التطبيق بصفحات التفاصيل، و `decoding="async"` + `loading="lazy"` للباقي.
- **لم** أحوّل صور الألعاب/التطبيقات إلى `next/image`: روابطها خارجية من مضيفين غير معروفين (أي `https:` حسب CSP) و `next/image` بيتطلب `remotePatterns` صريحة. توصية بالأسفل.
- `next.config.mjs`: `images.formats` (avif/webp)، و `Cache-Control` (يوم + stale-while-revalidate) لـ `/images/*` و `/wallpapers/generated/*` والأيقونات. (محصور بمسارات الملفات الساكنة حتى ما يتأثر `/wallpapers/[id]` كصفحة.)
- حزمة MediaPipe كانت أصلاً `import()` ديناميكي داخل صفحة الدمج فقط — ما احتاجت تغيير.

## 6) Caching

- Data cache: الرئيسية و /rankings (60s).
- `public/sw.js` (v3): القديم كان يخزّن **كل** GET غير-document بعد ما يجيبه من الشبكة، ومنها RSC payloads لصفحات ديناميكية (ممكن تحتوي بيانات المستخدم) بدون فايدة سرعة (network-first) وبدون حد للنمو. الجديد: cache-first لـ `/_next/static/` والصور الساكنة فقط، network-first للصفحات مع fallback للـ shell، وما يخزّن غيرها. (`/api|auth|wallet|orders|payment|admin` ما زالت مستثناة.)

## 7) Loading states

كان فقط `app/loading.tsx` و `app/admin/loading.tsx`. أُضيف `loading.tsx` (skeleton بدون JS عبر `components/ui/ListSkeleton`) لـ: `games`, `games/[slug]`, `apps`, `marketplace`, `wallpapers`, `rankings`, `mods`, `gift-cards`, `profile/gamer`.

---

## توصيات لم تُنفّذ (قرار/اختبار منك)

1. **بحث `contains` + `mode: insensitive`** (`/games?q=`, `/api/search`, الخلفيات) = sequential scan على Postgres. الحل: `pg_trgm` + GIN، مثلاً  
   `CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE INDEX "Game_titleEn_trgm" ON "Game" USING gin ("titleEn" gin_trgm_ops);` (وكذلك `titleAr`).  
   ما أضفته كـ migration لأنه بيحتاج صلاحية `CREATE EXTENSION` على قاعدة الإنتاج.
2. **next/image للصور الخارجية**: حدّد المضيفين (RAWG/Vercel Blob…) في `images.remotePatterns` ثم بدّل `<img>` بـ `<Image>`.
3. **`viewCount` increment** على كل زيارة لصفحة اللعبة = كتابة DB لكل view (hot row). الأفضل تجميع/تأخير الكتابة أو عدّاد خارجي.
4. صفحات `recommendations` و `social` بتجلب بياناتها بـ `useEffect` بعد التحميل؛ ممكن تتحول إلى Server Components تستدعي الـ lib مباشرة.
5. `/api/search` ما زال `include` كامل (30+30 صف)؛ يحتاج `select` مع الحفاظ على شكل الـ response للمستهلكين الخارجيين.
6. تفعيل cache invalidation فوري عند تعديل الإدارة: `revalidateTag("home-catalog", "max")` من routes الإدارة (حاليًا التحديث خلال ≤ 60s).
7. مكوّنات غير مستخدمة (dead code): `AIBanner`, `VipBanner`, `PlatformRow`, `CategoriesRow`, `AccountNav` — احذفها أو استخدمها.
8. فكّر بـ `staleTimes`/`cacheComponents` في Next 16 بعد اختبار شامل.

## الملفات المتغيّرة (ملخص)

جديد: `lib/home-data.ts`, `lib/client-auth.ts`, `components/ui/LocaleProvider.tsx`, `components/ui/ListSkeleton.tsx`, 9× `loading.tsx`, `prisma/migrations/20261010100000_phase16_performance_indexes/`, هذا التقرير.  
معدّل: `prisma/schema.prisma`, `next.config.mjs`, `public/sw.js`, `app/layout.tsx`, `app/page.tsx`, `app/games/page.tsx`, `app/games/[slug]/page.tsx`, `app/apps/[slug]/page.tsx`, `app/profile/gamer/page.tsx`, `app/rankings/page.tsx`, `app/marketplace/page.tsx`, `app/wallpapers/*`, `app/api/wallpapers/[id]/media/route.ts`, `app/api/me/recommendations/route.ts`, `app/public-ui.css`, `components/layout/SiteHeader.tsx`, `components/layout/SiteFooter.tsx`, `components/home/{GameRow,HeroCarousel}.tsx`, `components/ui/{LocaleText,LanguageSwitcher}.tsx`, `components/ui/useLocale.ts`, `components/auth/{LoginForm,RegisterForm,AccountNav}.tsx`, `components/games/ApiAccessClient.tsx`, `app/profile/profile.module.css`.
