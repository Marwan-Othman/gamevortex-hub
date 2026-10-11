# المرحلة 12 — Admin Dashboard

## ما تم إصلاحه
- app/admin/layout.tsx جديد: إطار موحّد (شريط جانبي + قائمة موبايل) لكل /admin/*؛ أُزيل AdminShell من dashboard وcontrol-center وmods وtrading.
- AdminShell: كل الروابط لصفحات حقيقية، حُذفت عناصر "قريبًا" الميتة والمكررة، بحث انتقال سريع يعمل، تمييز العنصر النشط الأدق، قائمة موبايل قابلة للطي.
- app/admin/loading.tsx + error.tsx: حالات تحميل وخطأ داخل الإطار مع إعادة محاولة وتسجيل الخطأ.
- المراجعة والإشراف: أزرار قرار للبلاغات (ModerationReportActions) + دمج مدخل مراجعة الخلفيات.
- مراجعة الخلفيات: استبدال form فارغ وسكربت مضمّن بمكوّن؛ إضافة guardMutation/guardRead للـ API.
- حارس المالك الموحّد (getOwnerOrAccessScreen) في dashboard وcontrol-center وai وmoderation.
- lib/admin-client.ts: رسائل أخطاء عربية موحّدة.
- معالجة أخطاء/تحميل: الدعم الفني، القرآن، مراقبة AI، حذف Mods والخلفيات، تخصيص التداول، الأدوار، السحوبات (تأكيد قبل سحب الفائز/الإلغاء)، إلغاء مفتاح API.
- موبايل: جداول بتمرير أفقي، تخطيط الدعم عمود واحد، تعطيل الحشوة المزدوجة لـ .wrap داخل الإطار.
- owner-control: روابط للصفحات الناقصة.

## لم يُفحص / ملاحظات
- لم يُشغَّل tsc الكامل ولا next build (لا node_modules). فُحصت الصياغة فقط. شغّل npm run build:production أو Preview قبل الدمج.
- خطأ TS18047 في app/api/admin/content/[type]/[id]/route.ts (categoryIds) قديم وغير مرتبط.
- ContentManager وصفحة المتجر وFazerCardsImporter ولوحات التداول التفصيلية لم تُراجع بعمق هنا.
- إجراء "تسجيل الإخفاء" في البلاغات يسجّل القرار فقط ولا يخفي المحتوى تلقائيًا (سلوك الـ API الحالي).
- بعض مسارات GET الإدارية بلا guardRead (مقبول لأنها للمالك فقط).
