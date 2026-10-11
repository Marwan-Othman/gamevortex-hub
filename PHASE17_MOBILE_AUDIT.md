# المرحلة 17 — Mobile Audit

التاريخ: 2026-10-10 · الأساس: `GameVortex_Phase16_Performance`

> **ملاحظة تحقق:** بيئة العمل بدون متصفح وبدون npm، فالفحص كان **ثابت (static)** على الكود، مو اختبار بصري على جهاز.
> اللي تحقق فعليًا: `test:source` ✅ و `test:owner-policy` ✅ + توازن الأقواس في CSS الجديد.
> **قبل النشر:** `npm install && npm run typecheck && npm run build` ثم جرّب الصفحات المذكورة تحت على موبايل حقيقي.

## المشاكل اللي انلقت وانصلحت

| # | المكان | المشكلة | الإصلاح |
|---|---|---|---|
| 1 | `app/layout.tsx` | بدون `viewport-fit=cover` → كل `env(safe-area-inset-*)` (21 استخدام) = 0 على iPhone؛ الـ Bottom Nav بيلزق بخط الـ Home | أُضيف `viewportFit: "cover"` + padding جانبي للـ notch بالوضع الأفقي |
| 2 | **AI Chat** `/ai` | عمود جانبي ثابت 260px بدون أي media query → منطقة المحادثة بتصير ~40px | `gv-m-split` يكدّس العمودين، الإدخال عمودي، زر إرسال كامل العرض، ارتفاع بـ `dvh` |
| 3 | **Smart Merge** `/wallpapers/merge` (V2 المستخدمة) | عمود جانبي ثابت 360px وما في media query نهائيًا | نفس التكديس |
| 4 | **Wallpaper Studio** | الـ media query كان بـ attribute selector على `style` (هش — ما بيطابق تسلسل React) | استبداله بـ class ثابت |
| 5 | **الدعم الفني** `/support` | شبكة `minmax(220px,…)` inline → عمود الرسائل مضغوط | تكديس على الشاشات ≤900px |
| 6 | **جدول الإحالات** `/referrals` | جدول بدون غلاف تمرير + قاعدة عامة `table{min-width:620px}` → الصفحة كلها تنزاح أفقيًا | غلاف `.gv-table-scroll` |
| 7 | حقول الإدخال | 16px كان فقط ≤430px (آيفونات الكبيرة 440px بتعمل zoom) + حقل بحث الهيدر 13px | 16px لحد 767px |
| 8 | `100vh` | شريط Safari بيخفي أسفل الصفحة/المودال | `100dvh` (body، AI Hub/Media، مودال الدمج، صور الخلفيات) |
| 9 | Modals | `maxHeight: 92vh` + بدون safe-area | `.gv-m-modal`: يلتصق بالأسفل، تمرير داخلي، يراعي safe-area |
| 10 | Touch targets | أزرار/حقول تحت 44px | `min-height:44px` للأزرار والحقول وcheckbox/radio على الموبايل |
| 11 | Toasts | `bottom:76px` فوق الـ Nav الجديد (84-88px) | `92px + safe-area` وعرض كامل |
| 12 | نصوص طويلة | إيميلات/روابط/كود بتوسّع الكرت | `overflow-wrap:anywhere` + `pre/code` بتمرير داخلي |

## تم فحصه وهو سليم (بدون تغيير)

- **Navigation / Sidebar:** الدرج (drawer) و Bottom Nav شغالين؛ سايد بار الأدمن مخفي ≤959px والتنقل داخل الصفحة.
- **Admin tables** (المستخدمون، المحفظة، المكافآت، API keys، التداول): كلها بغلاف `overflow-x:auto`.
- **Upload:** حقول الملفات بعرض كامل؛ أُضيف حد أدنى للارتفاع.
- **Games / Store:** الشبكات `minmax(0,…)` وتنزل لعمودين/عمود؛ ما في عرض ثابت يتجاوز 320px.

## ملفات التعديل

`app/mobile.css` (جديد) · `app/layout.tsx` · `app/referrals/page.tsx` · `components/ai/AiHubClient.tsx` · `components/ai/AiMediaClient.tsx` · `components/support/SupportCenter.tsx` · `app/wallpapers/merge/SmartMerge.tsx` · `app/wallpapers/merge/SmartMergeV2.tsx` · `app/wallpapers/studio/WallpaperStudioPro.tsx` · `app/wallpapers/studio/WallpaperStudioClient.tsx` · `app/wallpapers/[id]/page.tsx`

## توصية

اختبر على: iPhone SE (320/375)، iPhone Pro Max (430/440)، Android 360، وبالوضع الأفقي — خصوصًا `/ai` و `/wallpapers/merge` و `/support`.
