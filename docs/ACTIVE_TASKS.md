# Active backlog

This file is the persistent record of the implementation backlog for the current working branch. It is updated as tasks are completed or changed.

## Status

- [x] إنشاء API ومفاتيحه
- [x] ربط شراء الوصول
- [x] مركز إدارة API للمالك
- [x] تتبع أرباح المالك
- [x] مكافآت نقاط المنتجات
- [x] توحيد قيمة النقاط
- [x] محافظ السحب
- [x] تحسين مصادر الإيرادات
- [x] تقوية الخصوصية والأمان
- [x] إنشاء نظام الدعم
- [x] خصم النقاط للسحب
- [x] إزالة البيانات الوهمية
- [x] سجل نقاط دائم
- [x] فصل محفظة المالك

## AI tasks completed

- [x] واجهة AI داخل الموقع على `/ai`
- [x] سجل محادثات المستخدم مع إنشاء/إعادة تسمية/حذف المحادثة
- [x] نقطة حالة التشغيل: جاهز / غير مهيأ / بدون نموذج / غير متصل
- [x] تكوين وقت التشغيل الذكي للـ AI ومفاتيح الوصول
- [x] بوابة Ollama / self-hosted AI مع التحقق من الرمز والنموذج
- [x] منع أدوات/التحكم الخارجي في 요청ات AI
- [x] فحص سلامة البوابة والأمان واختبارات حالة النموذج
- [x] توثيق متغيرات البيئة اللازمة لنشر AI في الإنتاج

## Notes

- The owner-finance summary now separates real cash from point-based balances in the control center.
- Revenue, withdrawal, and point-ledger logic is kept in the real Prisma models and not resolved with fake values.
- Any external provider integration remains gated behind actual environment configuration and verification in production.
- The AI system is implemented and tracked, but a live runtime still requires a real deployed Ollama-compatible server and valid environment variables in Vercel or the target host.
