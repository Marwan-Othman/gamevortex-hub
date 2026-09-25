import Link from "next/link";
import flags from "../../config/feature-flags.json";

const items = [
  ["AI Assistant", "مساعد ذكي داخل المنصة", flags.aiAssistant],
  ["AI Smart Search", "فهم البحث الطبيعي واكتشاف الألعاب", flags.aiSmartSearch],
  ["AI Recommendations", "توصيات شخصية لكل مستخدم", flags.aiRecommendations],
  ["AI Discovery", "اكتشاف الألعاب والمحتوى الجديد", flags.aiDiscovery],
  ["AI Moderation", "مساعدة فريق الإدارة في مراجعة المحتوى", flags.aiModeration],
];

export default function AIPage() {
  return <main className="wrap" dir="rtl">
    <section className="glass hero">
      <span className="badge">AI FOUNDATION</span>
      <h1>مركز الذكاء الاصطناعي</h1>
      <p>تم تجهيز واجهة موحدة لحالة ميزات AI بدون الادعاء بوجود مزود أو مفتاح API غير مُهيأ.</p>
    </section>
    <section className="grid">
      {items.map(([name, description, enabled]) => <article className="glass card" key={String(name)}>
        <h2>🤖 {name}</h2><p className="muted">{description}</p>
        <span className={enabled ? "status-ready" : "status-off"}>{enabled ? "مفعّل" : "بانتظار مزود AI"}</span>
      </article>)}
    </section>
    <section className="glass card feature-grid">
      <h2>معمارية التشغيل</h2>
      <p>عند تفعيل المزود، يجب أن تمر الطلبات عبر طبقة خادم واحدة للتحكم في الأسرار، الصلاحيات، حدود التكلفة، التسجيل، ومقاومة Prompt Injection. لا يتم وضع مفاتيح AI في المتصفح.</p>
      <Link className="btn" href="/admin">العودة إلى لوحة المالك</Link>
    </section>
  </main>;
}
