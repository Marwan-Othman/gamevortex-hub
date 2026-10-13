# Patch: زر "أدوات" في صفحة تفاصيل الخلفية
- app/wallpapers/[id]/page.tsx : زر 🎨 يفتح الاستوديو بالخلفية الحالية (صور فقط، ولمن يحق له مشاهدتها).
- app/wallpapers/studio/page.tsx : يقرأ ?wallpaper=ID ويتحقق (منشورة + معتمدة + ليست فيديو).
- app/wallpapers/studio/WallpaperStudioPro.tsx : prop جديد initialWallpaperId يفتح الخلفية وتبويب الطبقات.
لا تغييرات في قاعدة البيانات. حماية VIP تبقى على الخادم عبر /api/wallpapers/[id]/media.
