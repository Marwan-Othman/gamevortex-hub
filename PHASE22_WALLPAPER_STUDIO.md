# Phase 22 — GameVortex Wallpaper Studio + VIP

## ما الذي تغيّر
**جديد**
- `lib/wallpaper-studio-policy.ts` — سياسة الصلاحيات (قوالب/خطوط/تأثيرات VIP، حدود الحفظ، مخطط التحقق zod).
- `lib/wallpaper-studio.ts` — منطق الخادم (قراءة VIP من `getVipAccess`، التحقق من الحمولة والخلفية، حد الحفظ).
- `lib/image-sniff.ts` — تحديد نوع الصورة من البايتات.
- `app/api/wallpapers/studio/library/route.ts` — مكتبة بصفحات (cursor) مع قفل VIP.
- `app/api/wallpapers/studio/designs/route.ts` و `designs/[id]/route.ts` — حفظ/فتح/تحديث/حذف التصاميم مع فرض الملكية.
- `app/wallpapers/studio/studio-render.ts` / `studio-templates.ts` / `studio-storage.ts`.
- `prisma/migrations/20261012000000_add_wallpaper_designs/migration.sql` — جدول `WallpaperDesign` (إضافة فقط).
- `tests/wallpaper-studio-policy.test.ts` و `tests/wallpaper-studio-api.test.ts`.

**معدّل**
- `prisma/schema.prisma` — نموذج `WallpaperDesign` + علاقتان عكسيتان (`User.wallpaperDesigns`, `Wallpaper.designs`).
- `app/wallpapers/studio/page.tsx` و `WallpaperStudioPro.tsx` (أُعيد بناؤه بالكامل).

**لم يُمس**: `StudioMergeImport.tsx`، `SmartMergeLauncher.tsx`، `lib/vip.ts`، مسارات `/api/wallpapers/[id]/media|download`، لوحة الإدارة، `WallpaperStudioClient.tsx` (غير مستخدم لكنه محفوظ).

## ربط VIP
كل القرارات من `getVipAccess(userId)` (قاعدة البيانات): SUPER_ADMIN = Owner بلا حدود، اشتراك ACTIVE غير منتهٍ = VIP، غير ذلك = مجاني (يشمل المنتهي).
الخادم يرفض (403 `VIP_REQUIRED`) أي حفظ يحتوي قالبًا/خطًا/تأثيرًا/توهجًا من VIP أو خلفية VIP لغير المشترك، ويتجاهل أي `isVip` يرسله المتصفح.
ملفات خلفيات VIP محمية أصلًا في `/api/wallpapers/[id]/media` و`/download`؛ المكتبة تعرضها مقفلة بلا رابط للمجاني.

## حدود الحفظ (تحتاج موافقتك)
لم يكن في المشروع أي حد سابق. وضعت افتراضيًا: مجاني 5، VIP 50، المالك بلا حد — في `STUDIO_SAVE_LIMITS`.

## قيود معروفة
- التصدير يتم في المتصفح، فمنع عناصر VIP عند التصدير هو في الواجهة؛ الإنفاذ الحقيقي على الخادم يخص الحفظ وملفات الخلفيات.
- الصور الخاصة المرفوعة من الهاتف تبقى في IndexedDB على نفس الجهاز/المتصفح (لا تُرفع، ولا تُزامن بين الأجهزة).
- خطوط VIP هي خطوط نظام؛ ظهورها يختلف حسب الجهاز.
- إدارة «القوالب المتاحة» من لوحة الإدارة لم تُنفّذ: القوالب معرّفة في الكود.
- يجب تشغيل `npm run db:deploy` لتطبيق الترحيل قبل استخدام الحفظ على الخادم.
